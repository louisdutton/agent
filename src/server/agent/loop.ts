// Agent loop - executes turns with tool calling

import { getConfig } from "../config";
import type { Provider, ToolDefinition } from "../providers/types";
import type { WireEvent } from "../wire/types";
import type { ToolRegistry } from "./tools";
import type { Session, Tool, ToolCall } from "./types";

const MAX_STEPS_PER_TURN = 50;

/**
 * Validate tool input against schema's required fields
 */
function validateToolInput(tool: Tool, input: unknown): string | null {
	if (input === null || input === undefined) {
		return `Tool ${tool.name}: input is ${input}`;
	}

	if (typeof input !== "object") {
		return `Tool ${tool.name}: input must be an object, got ${typeof input}`;
	}

	const schema = tool.inputSchema;
	const required = schema.required as string[] | undefined;

	if (!required || required.length === 0) {
		return null;
	}

	const inputObj = input as Record<string, unknown>;
	const missing: string[] = [];

	for (const field of required) {
		if (!(field in inputObj) || inputObj[field] === undefined) {
			missing.push(field);
		}
	}

	if (missing.length > 0) {
		return `Tool ${tool.name}: missing required parameters: ${missing.join(", ")}`;
	}

	return null;
}

type LoopOptions = {
	maxSteps?: number;
	signal?: AbortSignal;
	onPersist?: () => Promise<void>;
};

/**
 * Run the agent loop for a single turn.
 * Streams events, executes tools, loops until done or max steps.
 */
export async function runAgentLoop(
	session: Session,
	provider: Provider,
	tools: ToolRegistry,
	systemPrompt: string,
	emit: (event: WireEvent) => void,
	requestApproval: (toolCall: ToolCall) => Promise<boolean>,
	options: LoopOptions = {},
): Promise<void> {
	const { maxSteps = MAX_STEPS_PER_TURN, signal, onPersist } = options;

	emit({
		type: "turn_begin",
		sessionId: session.id,
		userMessage: getLastUserMessage(session),
	});

	for (let step = 0; step < maxSteps; step++) {
		if (signal?.aborted) {
			break;
		}

		emit({ type: "step_begin", sessionId: session.id, step });

		// Stream a step from the LLM
		const { text, toolCalls, usage } = await streamStep(
			session,
			provider,
			tools.list(),
			systemPrompt,
			emit,
			signal,
		);

		if (usage) {
			emit({ type: "usage", ...usage });
		}

		emit({ type: "step_end", sessionId: session.id, step });

		// Append assistant message to history
		appendAssistantMessage(session, text, toolCalls);

		// If no tool calls, turn is complete
		if (toolCalls.length === 0) {
			break;
		}

		// Execute tool calls
		for (const call of toolCalls) {
			if (signal?.aborted) break;

			// Check for JSON parse errors from streaming
			if (call.parseError) {
				appendToolResult(session, call.id, call.parseError, true);
				emit({
					type: "tool_result",
					toolCallId: call.id,
					content: call.parseError,
					isError: true,
				});
				continue;
			}

			const tool = tools.get(call.name);
			if (!tool) {
				appendToolResult(session, call.id, `Unknown tool: ${call.name}`, true);
				emit({
					type: "tool_result",
					toolCallId: call.id,
					content: `Unknown tool: ${call.name}`,
					isError: true,
				});
				continue;
			}

			// Validate required input fields from schema
			const validationError = validateToolInput(tool, call.input);
			if (validationError) {
				appendToolResult(session, call.id, validationError, true);
				emit({
					type: "tool_result",
					toolCallId: call.id,
					content: validationError,
					isError: true,
				});
				continue;
			}

			// Check approval if needed (skip if global requireApproval is off)
			const config = await getConfig();
			if (config.requireApproval && tool.requiresApproval) {
				const approved = await requestApproval(call);
				if (!approved) {
					appendToolResult(
						session,
						call.id,
						"Tool execution rejected by user",
						true,
					);
					emit({
						type: "tool_result",
						toolCallId: call.id,
						content: "Tool execution rejected by user",
						isError: true,
					});
					continue;
				}
			}

			// Execute tool
			const result = await tool.execute(call.input, {
				workDir: session.projectPath,
				sessionId: session.id,
				signal,
			});

			appendToolResult(session, call.id, result.content, result.isError);
			emit({
				type: "tool_result",
				toolCallId: call.id,
				content: result.content,
				isError: result.isError,
			});
		}

		// Persist after each step for crash safety
		if (onPersist) {
			try {
				await onPersist();
			} catch (err) {
				console.error("Failed to persist session:", err);
			}
		}
	}

	emit({ type: "turn_end", sessionId: session.id });
}

/**
 * Stream a single step from the LLM
 */
async function streamStep(
	session: Session,
	provider: Provider,
	tools: Tool[],
	systemPrompt: string,
	emit: (event: WireEvent) => void,
	signal?: AbortSignal,
): Promise<{
	text: string;
	toolCalls: ToolCall[];
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
}> {
	const toolDefs: ToolDefinition[] = tools.map((t) => ({
		name: t.name,
		description: t.description,
		inputSchema: t.inputSchema,
	}));

	let text = "";
	const toolCalls: ToolCall[] = [];
	const toolInputBuffers = new Map<string, string>();
	let usage:
		| {
				inputTokens: number;
				outputTokens: number;
				cacheRead?: number;
				cacheWrite?: number;
		  }
		| undefined;

	const stream = provider.stream(session.messages, {
		systemPrompt,
		tools: toolDefs,
		signal,
	});

	for await (const chunk of stream) {
		switch (chunk.type) {
			case "text":
				text += chunk.text;
				emit({ type: "text", text: chunk.text });
				break;

			case "tool_use_start":
				toolInputBuffers.set(chunk.id, "");
				emit({ type: "tool_use_start", id: chunk.id, name: chunk.name });
				// Store name for later
				toolCalls.push({ id: chunk.id, name: chunk.name, input: {} });
				break;

			case "tool_use_delta": {
				const buffer = (toolInputBuffers.get(chunk.id) ?? "") + chunk.input;
				toolInputBuffers.set(chunk.id, buffer);
				emit({ type: "tool_use_delta", id: chunk.id, input: chunk.input });
				break;
			}

			case "tool_use_end": {
				const inputJson = toolInputBuffers.get(chunk.id) ?? "{}";
				let input: unknown = {};
				let parseError: string | undefined;
				try {
					input = JSON.parse(inputJson);
				} catch (err) {
					parseError = `Failed to parse tool input JSON: ${err}`;
					console.error(parseError, { toolId: chunk.id, inputJson });
				}
				// Update the tool call with parsed input
				const call = toolCalls.find((c) => c.id === chunk.id);
				if (call) {
					call.input = input;
					if (parseError) {
						call.parseError = parseError;
					}
				}
				emit({
					type: "tool_use_end",
					id: chunk.id,
					name: call?.name ?? "",
					input,
				});
				break;
			}

			case "usage":
				usage = {
					inputTokens: chunk.inputTokens,
					outputTokens: chunk.outputTokens,
					cacheRead: chunk.cacheRead,
					cacheWrite: chunk.cacheWrite,
				};
				break;

			case "error":
				emit({ type: "error", sessionId: session.id, error: chunk.error });
				break;

			case "done":
				if (text) {
					emit({ type: "text_done", text });
				}
				break;
		}
	}

	return { text, toolCalls, usage };
}

function getLastUserMessage(session: Session): string {
	for (let i = session.messages.length - 1; i >= 0; i--) {
		const msg = session.messages[i];
		if (msg.role === "user") {
			return typeof msg.content === "string"
				? msg.content
				: "(multipart message)";
		}
	}
	return "";
}

function appendAssistantMessage(
	session: Session,
	text: string,
	toolCalls: ToolCall[],
): void {
	const content: Array<{ type: string; [key: string]: unknown }> = [];

	if (text) {
		content.push({ type: "text", text });
	}

	for (const call of toolCalls) {
		content.push({
			type: "tool_use",
			id: call.id,
			name: call.name,
			input: call.input,
		});
	}

	if (content.length > 0) {
		session.messages.push({
			role: "assistant",
			content: content as Session["messages"][number]["content"],
		});
	}
}

function appendToolResult(
	session: Session,
	toolUseId: string,
	content: string,
	isError?: boolean,
): void {
	session.messages.push({
		role: "user", // Tool results are sent as user messages in Anthropic API
		content: [
			{
				type: "tool_result",
				toolUseId,
				content,
				isError,
			},
		],
	});
}
