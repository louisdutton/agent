// Provider abstraction layer - supports multiple LLM backends

export type Role = "user" | "assistant";

export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image"; mediaType: string; data: string };
export type ToolUsePart = {
	type: "tool_use";
	id: string;
	name: string;
	input: unknown;
};
export type ToolResultPart = {
	type: "tool_result";
	toolUseId: string;
	content: string;
	isError?: boolean;
};

export type ContentPart = TextPart | ImagePart | ToolUsePart | ToolResultPart;

export type Message = {
	role: Role;
	content: string | ContentPart[];
};

export type ToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

// Streaming chunks from provider
export type StreamChunk =
	| { type: "text"; text: string }
	| { type: "tool_use_start"; id: string; name: string }
	| { type: "tool_use_delta"; id: string; input: string }
	| { type: "tool_use_end"; id: string }
	| {
			type: "usage";
			inputTokens: number;
			outputTokens: number;
			cacheRead?: number;
			cacheWrite?: number;
	  }
	| { type: "done"; stopReason: string }
	| { type: "error"; error: string };

export type StreamCallback = (chunk: StreamChunk) => void;

// Provider interface
export interface Provider {
	readonly name: string;
	readonly model: string;
	readonly maxContextTokens: number;

	/**
	 * Stream a completion from the provider
	 */
	stream(
		messages: Message[],
		options: StreamOptions,
	): AsyncGenerator<StreamChunk>;

	/**
	 * Count tokens for messages (approximate)
	 */
	countTokens(messages: Message[]): Promise<number>;
}

export type StreamOptions = {
	systemPrompt?: string;
	tools?: ToolDefinition[];
	maxTokens?: number;
	signal?: AbortSignal;
};

// Provider configuration
export type ProviderConfig = {
	apiKey?: string;
	baseUrl?: string;
	model?: string;
};
