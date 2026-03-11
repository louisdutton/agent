// Anthropic provider implementation

import { homedir } from "node:os";
import { join } from "node:path";
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
const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

type Credentials = {
	claudeAiOauth?: {
		accessToken: string;
	};
};

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

// Try to load OAuth token from Claude Code credentials
async function loadOAuthToken(): Promise<string | null> {
	try {
		const file = Bun.file(CREDENTIALS_PATH);
		if (!(await file.exists())) return null;
		const creds = (await file.json()) as Credentials;
		return creds.claudeAiOauth?.accessToken ?? null;
	} catch {
		return null;
	}
}

type AuthConfig =
	| { type: "apiKey"; apiKey: string }
	| { type: "oauth"; token: string };

export function createAnthropicProvider(config: ProviderConfig = {}): Provider {
	const model = config.model ?? DEFAULT_MODEL;
	const baseUrl = config.baseUrl ?? "https://api.anthropic.com";

	// Lazy auth initialization
	let auth: AuthConfig | null = null;
	let authPromise: Promise<AuthConfig> | null = null;

	async function getAuth(): Promise<AuthConfig> {
		if (auth) return auth;
		if (authPromise) return authPromise;

		authPromise = (async () => {
			// Try API key first
			const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
			if (apiKey) {
				auth = { type: "apiKey", apiKey };
				return auth;
			}

			// Fall back to OAuth token
			const oauthToken = await loadOAuthToken();
			if (oauthToken) {
				auth = { type: "oauth", token: oauthToken };
				return auth;
			}

			throw new Error(
				"Anthropic API key required (set ANTHROPIC_API_KEY or login with Claude Code)",
			);
		})();

		return authPromise;
	}

	// SDK client for API key auth (lazy)
	let sdkClient: Anthropic | null = null;
	function getSdkClient(apiKey: string): Anthropic {
		if (!sdkClient) {
			sdkClient = new Anthropic({ apiKey, baseURL: config.baseUrl });
		}
		return sdkClient;
	}

	return {
		name: "anthropic",
		model,
		maxContextTokens: MAX_CONTEXT_TOKENS,

		async *stream(
			messages: Message[],
			options: StreamOptions,
		): AsyncGenerator<StreamChunk> {
			const authConfig = await getAuth();

			// Use SDK for API key auth
			if (authConfig.type === "apiKey") {
				yield* streamWithSdk(
					getSdkClient(authConfig.apiKey),
					model,
					messages,
					options,
				);
				return;
			}

			// Use raw fetch for OAuth
			yield* streamWithOAuth(
				baseUrl,
				authConfig.token,
				model,
				messages,
				options,
			);
		},

		async countTokens(messages: Message[]): Promise<number> {
			const authConfig = await getAuth();

			if (authConfig.type === "apiKey") {
				try {
					const client = getSdkClient(authConfig.apiKey);
					const result = await client.messages.countTokens({
						model,
						messages: toAnthropicMessages(messages),
					});
					return result.input_tokens;
				} catch {
					// Fall through to estimate
				}
			}

			// Fallback: rough estimate (4 chars per token)
			const text = messages
				.map((m) =>
					typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				)
				.join("\n");
			return Math.ceil(text.length / 4);
		},
	};
}

// Stream using Anthropic SDK (for API key auth)
async function* streamWithSdk(
	client: Anthropic,
	model: string,
	messages: Message[],
	options: StreamOptions,
): AsyncGenerator<StreamChunk> {
	const { systemPrompt, tools, maxTokens = 8192, signal } = options;
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
							inputTokens: 0,
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
							cacheWrite: (usage as { cache_creation_input_tokens?: number })
								.cache_creation_input_tokens,
						};
					}
					break;
				}

				case "message_stop":
					break;
			}
		}

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
}

// Stream using raw fetch for OAuth (SDK doesn't support Bearer auth properly)
async function* streamWithOAuth(
	baseUrl: string,
	token: string,
	model: string,
	messages: Message[],
	options: StreamOptions,
): AsyncGenerator<StreamChunk> {
	const { systemPrompt, tools, maxTokens = 8192, signal } = options;

	const body: Record<string, unknown> = {
		model,
		max_tokens: maxTokens,
		stream: true,
		messages: toAnthropicMessages(messages),
	};

	if (systemPrompt) {
		body.system = systemPrompt;
	}

	if (tools?.length) {
		body.tools = toAnthropicTools(tools);
	}

	try {
		const response = await fetch(`${baseUrl}/v1/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "prompt-caching-2024-07-31,oauth-2025-04-20",
			},
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const errorText = await response.text();
			yield { type: "error", error: `HTTP ${response.status}: ${errorText}` };
			return;
		}

		if (!response.body) {
			yield { type: "error", error: "No response body" };
			return;
		}

		let currentToolId: string | null = null;
		let currentToolName: string | null = null;
		let toolArgsBuffer = "";
		let inputTokens = 0;
		let outputTokens = 0;

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Process complete SSE lines
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				const data = line.slice(6);
				if (data === "[DONE]") continue;

				let event: Record<string, unknown>;
				try {
					event = JSON.parse(data);
				} catch {
					continue;
				}

				const eventType = event.type as string;

				switch (eventType) {
					case "error": {
						const error = event.error as { message?: string };
						yield {
							type: "error",
							error: error?.message ?? "Anthropic API error",
						};
						return;
					}

					case "message_start": {
						const msg = event.message as { usage?: Record<string, number> };
						if (msg?.usage) {
							inputTokens = msg.usage.input_tokens ?? 0;
							yield {
								type: "usage",
								inputTokens,
								outputTokens: 0,
								cacheRead: msg.usage.cache_read_input_tokens,
								cacheWrite: msg.usage.cache_creation_input_tokens,
							};
						}
						break;
					}

					case "content_block_start": {
						const block = event.content_block as {
							type: string;
							id?: string;
							name?: string;
						};
						if (block?.type === "tool_use") {
							currentToolId = block.id ?? null;
							currentToolName = block.name ?? null;
							toolArgsBuffer = "";
							if (currentToolId && currentToolName) {
								yield {
									type: "tool_use_start",
									id: currentToolId,
									name: currentToolName,
								};
							}
						}
						break;
					}

					case "content_block_delta": {
						const delta = event.delta as {
							type: string;
							text?: string;
							partial_json?: string;
						};
						if (delta?.type === "text_delta" && delta.text) {
							yield { type: "text", text: delta.text };
						} else if (
							delta?.type === "input_json_delta" &&
							delta.partial_json &&
							currentToolId
						) {
							toolArgsBuffer += delta.partial_json;
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
							currentToolName = null;
							toolArgsBuffer = "";
						}
						break;
					}

					case "message_delta": {
						const usage = event.usage as { output_tokens?: number };
						if (usage?.output_tokens) {
							outputTokens = usage.output_tokens;
							yield {
								type: "usage",
								inputTokens: 0,
								outputTokens,
							};
						}
						break;
					}

					case "message_stop": {
						yield { type: "done", stopReason: "end_turn" };
						break;
					}
				}
			}
		}
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			yield { type: "done", stopReason: "cancelled" };
		} else {
			yield { type: "error", error: String(err) };
		}
	}
}
