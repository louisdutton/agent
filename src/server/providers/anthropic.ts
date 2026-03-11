// Anthropic provider implementation

import Anthropic from "@anthropic-ai/sdk";
import type {
	ContentPart,
	Message,
	Provider,
	ProviderConfig,
	StreamChunk,
	StreamOptions,
	ToolDefinition,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_CONTEXT_TOKENS = 200_000;

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicContent = Anthropic.ContentBlockParam;
type AnthropicTool = Anthropic.Tool;

function toAnthropicContent(
	content: string | ContentPart[],
): AnthropicContent[] {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}

	return content.map((part): AnthropicContent => {
		switch (part.type) {
			case "text":
				return { type: "text", text: part.text };
			case "image":
				return {
					type: "image",
					source: {
						type: "base64",
						media_type: part.mediaType as
							| "image/jpeg"
							| "image/png"
							| "image/gif"
							| "image/webp",
						data: part.data,
					},
				};
			case "tool_use":
				return {
					type: "tool_use",
					id: part.id,
					name: part.name,
					input: part.input as Record<string, unknown>,
				};
			case "tool_result":
				return {
					type: "tool_result",
					tool_use_id: part.toolUseId,
					content: part.content,
					is_error: part.isError,
				};
		}
	});
}

function toAnthropicMessages(messages: Message[]): AnthropicMessage[] {
	return messages.map((msg) => ({
		role: msg.role,
		content: toAnthropicContent(msg.content),
	}));
}

function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
	}));
}

export function createAnthropicProvider(config: ProviderConfig = {}): Provider {
	const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
	if (!apiKey) {
		throw new Error(
			"Anthropic API key required (set ANTHROPIC_API_KEY or pass apiKey)",
		);
	}

	const client = new Anthropic({
		apiKey,
		baseURL: config.baseUrl,
	});

	const model = config.model ?? DEFAULT_MODEL;

	return {
		name: "anthropic",
		model,
		maxContextTokens: MAX_CONTEXT_TOKENS,

		async *stream(
			messages: Message[],
			options: StreamOptions,
		): AsyncGenerator<StreamChunk> {
			const { systemPrompt, tools, maxTokens = 8192, signal } = options;

			// Track current tool call for delta accumulation
			let currentToolId: string | null = null;

			try {
				const streamParams: Anthropic.MessageCreateParams = {
					model,
					max_tokens: maxTokens,
					messages: toAnthropicMessages(messages),
				};

				if (systemPrompt) {
					streamParams.system = systemPrompt;
				}

				if (tools?.length) {
					streamParams.tools = toAnthropicTools(tools);
				}

				const stream = client.messages.stream(streamParams, {
					signal: signal ?? undefined,
				});

				for await (const event of stream) {
					switch (event.type) {
						case "content_block_start": {
							const block = event.content_block;
							if (block.type === "tool_use") {
								currentToolId = block.id;
								yield {
									type: "tool_use_start",
									id: block.id,
									name: block.name,
								};
							}
							break;
						}

						case "content_block_delta": {
							const delta = event.delta;
							if (delta.type === "text_delta") {
								yield { type: "text", text: delta.text };
							} else if (delta.type === "input_json_delta" && currentToolId) {
								yield {
									type: "tool_use_delta",
									id: currentToolId,
									input: delta.partial_json,
								};
							}
							break;
						}

						case "content_block_stop": {
							if (currentToolId) {
								yield { type: "tool_use_end", id: currentToolId };
								currentToolId = null;
							}
							break;
						}

						case "message_delta": {
							const usage = event.usage;
							if (usage) {
								yield {
									type: "usage",
									inputTokens: 0, // Only available in message_start
									outputTokens: usage.output_tokens,
								};
							}
							break;
						}

						case "message_start": {
							const usage = event.message.usage;
							if (usage) {
								yield {
									type: "usage",
									inputTokens: usage.input_tokens,
									outputTokens: 0,
									cacheRead: (usage as { cache_read_input_tokens?: number })
										.cache_read_input_tokens,
									cacheWrite: (
										usage as { cache_creation_input_tokens?: number }
									).cache_creation_input_tokens,
								};
							}
							break;
						}

						case "message_stop": {
							// Final event - get stop reason from accumulated message
							break;
						}
					}
				}

				// Get final message for stop reason
				const finalMessage = await stream.finalMessage();
				yield {
					type: "done",
					stopReason: finalMessage.stop_reason ?? "end_turn",
				};
			} catch (err) {
				if (err instanceof Error && err.name === "AbortError") {
					yield { type: "done", stopReason: "cancelled" };
				} else {
					yield { type: "error", error: String(err) };
				}
			}
		},

		async countTokens(messages: Message[]): Promise<number> {
			try {
				const result = await client.messages.countTokens({
					model,
					messages: toAnthropicMessages(messages),
				});
				return result.input_tokens;
			} catch {
				// Fallback: rough estimate (4 chars per token)
				const text = messages
					.map((m) =>
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
					)
					.join("\n");
				return Math.ceil(text.length / 4);
			}
		},
	};
}
