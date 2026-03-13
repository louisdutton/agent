// Anthropic provider implementation

import { homedir } from "node:os";
import { join } from "node:path";
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

type AnthropicContent =
	| { type: "text"; text: string }
	| {
			type: "image";
			source: {
				type: "base64";
				media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
				data: string;
			};
	  }
	| {
			type: "tool_use";
			id: string;
			name: string;
			input: Record<string, unknown>;
	  }
	| {
			type: "tool_result";
			tool_use_id: string;
			content: string;
			is_error?: boolean;
	  };

type AnthropicMessage = {
	role: "user" | "assistant";
	content: AnthropicContent[];
};

type AnthropicTool = {
	name: string;
	description: string;
	input_schema: Record<string, unknown>;
};

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
		input_schema: tool.inputSchema,
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

	// Lazy auth initialization with refresh capability
	let auth: AuthConfig | null = null;
	let authPromise: Promise<AuthConfig> | null = null;

	async function getAuth(forceRefresh = false): Promise<AuthConfig> {
		if (forceRefresh) {
			auth = null;
			authPromise = null;
		}
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

	function clearAuth() {
		auth = null;
		authPromise = null;
	}

	return {
		name: "anthropic",
		model,
		maxContextTokens: MAX_CONTEXT_TOKENS,

		async *stream(
			messages: Message[],
			options: StreamOptions,
		): AsyncGenerator<StreamChunk> {
			let authConfig = await getAuth();

			// Try streaming, retry once with fresh auth on 401
			for await (const chunk of streamWithFetch(
				baseUrl,
				authConfig,
				model,
				messages,
				options,
			)) {
				if (chunk.type === "error" && chunk.error.includes("HTTP 401")) {
					// Token expired, refresh and retry
					clearAuth();
					authConfig = await getAuth(true);
					yield* streamWithFetch(baseUrl, authConfig, model, messages, options);
					return;
				}
				yield chunk;
			}
		},

		async countTokens(messages: Message[]): Promise<number> {
			// Rough estimate (4 chars per token)
			const text = messages
				.map((m) =>
					typeof m.content === "string" ? m.content : JSON.stringify(m.content),
				)
				.join("\n");
			return Math.ceil(text.length / 4);
		},
	};
}

// Build auth headers based on auth type
function buildHeaders(authConfig: AuthConfig): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"anthropic-version": "2023-06-01",
		"anthropic-beta": "prompt-caching-2024-07-31",
	};

	if (authConfig.type === "apiKey") {
		headers["x-api-key"] = authConfig.apiKey;
	} else {
		headers.Authorization = `Bearer ${authConfig.token}`;
		headers["anthropic-beta"] += ",oauth-2025-04-20";
	}

	return headers;
}

// Stream using raw fetch (works for both API key and OAuth)
async function* streamWithFetch(
	baseUrl: string,
	authConfig: AuthConfig,
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

	// Mark system prompt for caching (stable across turns)
	if (systemPrompt) {
		body.system = [
			{
				type: "text",
				text: systemPrompt,
				cache_control: { type: "ephemeral" },
			},
		];
	}

	// Mark tools for caching (stable across turns)
	if (tools?.length) {
		const anthropicTools = toAnthropicTools(tools);
		// Mark last tool with cache_control (caches all preceding tools)
		if (anthropicTools.length > 0) {
			anthropicTools[anthropicTools.length - 1] = {
				...anthropicTools[anthropicTools.length - 1],
				cache_control: { type: "ephemeral" },
			} as AnthropicTool & { cache_control: { type: string } };
		}
		body.tools = anthropicTools;
	}

	try {
		const response = await fetch(`${baseUrl}/v1/messages`, {
			method: "POST",
			headers: buildHeaders(authConfig),
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

		yield* parseSSEStream(response.body);
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			yield { type: "done", stopReason: "cancelled" };
		} else {
			yield { type: "error", error: String(err) };
		}
	}
}

// Parse SSE stream and yield StreamChunks
async function* parseSSEStream(
	body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
	let currentToolId: string | null = null;

	const reader = body.getReader();
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

			const chunk = processSSEEvent(event, currentToolId);
			if (chunk) {
				// Track tool state
				if (chunk.type === "tool_use_start") {
					currentToolId = chunk.id;
				} else if (chunk.type === "tool_use_end") {
					currentToolId = null;
				}
				yield chunk;
				if (chunk.type === "error") return;
			}
		}
	}
}

// Process a single SSE event into a StreamChunk
function processSSEEvent(
	event: Record<string, unknown>,
	currentToolId: string | null,
): StreamChunk | null {
	const eventType = event.type as string;

	switch (eventType) {
		case "error": {
			const error = event.error as { message?: string };
			return { type: "error", error: error?.message ?? "Anthropic API error" };
		}

		case "message_start": {
			const msg = event.message as { usage?: Record<string, number> };
			if (msg?.usage) {
				return {
					type: "usage",
					inputTokens: msg.usage.input_tokens ?? 0,
					outputTokens: 0,
					cacheRead: msg.usage.cache_read_input_tokens,
					cacheWrite: msg.usage.cache_creation_input_tokens,
				};
			}
			return null;
		}

		case "content_block_start": {
			const block = event.content_block as {
				type: string;
				id?: string;
				name?: string;
			};
			if (block?.type === "tool_use" && block.id && block.name) {
				return { type: "tool_use_start", id: block.id, name: block.name };
			}
			return null;
		}

		case "content_block_delta": {
			const delta = event.delta as {
				type: string;
				text?: string;
				partial_json?: string;
			};
			if (delta?.type === "text_delta" && delta.text) {
				return { type: "text", text: delta.text };
			}
			if (
				delta?.type === "input_json_delta" &&
				delta.partial_json &&
				currentToolId
			) {
				return {
					type: "tool_use_delta",
					id: currentToolId,
					input: delta.partial_json,
				};
			}
			return null;
		}

		case "content_block_stop": {
			if (currentToolId) {
				return { type: "tool_use_end", id: currentToolId };
			}
			return null;
		}

		case "message_delta": {
			const delta = event.delta as { stop_reason?: string };
			const usage = event.usage as { output_tokens?: number };
			if (usage?.output_tokens) {
				return {
					type: "usage",
					inputTokens: 0,
					outputTokens: usage.output_tokens,
				};
			}
			// Capture stop reason for done event
			if (delta?.stop_reason) {
				return { type: "done", stopReason: delta.stop_reason };
			}
			return null;
		}

		case "message_stop": {
			return { type: "done", stopReason: "end_turn" };
		}

		default:
			return null;
	}
}
