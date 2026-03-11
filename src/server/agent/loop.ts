// Agent loop - executes turns with tool calling

import type { Provider, ToolDefinition } from "../providers/types";
import type { WireEvent } from "../wire/types";
import type { ToolRegistry } from "./tools";
import type { Session, Tool, ToolCall } from "./types";

const MAX_STEPS_PER_TURN = 50;

type LoopOptions = {
	maxSteps?: number;
	signal?: AbortSignal;
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
	const { maxSteps = MAX_STEPS_PER_TURN, signal } = options;

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

			// Check approval if needed
			if (tool.requiresApproval) {
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
				try {
					input = JSON.parse(inputJson);
				} catch {
					// Keep empty object if parse fails
				}
				// Update the tool call with parsed input
				const call = toolCalls.find((c) => c.id === chunk.id);
				if (call) {
					call.input = input;
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
