/**
 * Types for the Claude CLI stdio protocol.
 * These types define the input/output format for communicating with the Claude CLI
 * via --input-format stream-json and --output-format stream-json.
 */

import type { UUID } from "node:crypto";

// ============================================================================
// Anthropic SDK Types (minimal subset needed for messages)
// ============================================================================

export type MessageRole = "user" | "assistant";

export type TextBlock = {
	type: "text";
	text: string;
};

export type ImageBlock = {
	type: "image";
	source: {
		type: "base64";
		media_type: string;
		data: string;
	};
};

export type ToolUseBlock = {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
};

export type ToolResultBlock = {
	type: "tool_result";
	tool_use_id: string;
	content: string | ContentBlock[];
	is_error?: boolean;
};

export type ThinkingBlock = {
	type: "thinking";
	thinking: string;
	signature?: string;
};

export type ContentBlock =
	| TextBlock
	| ImageBlock
	| ToolUseBlock
	| ToolResultBlock
	| ThinkingBlock;

export type MessageParam = {
	role: MessageRole;
	content: string | ContentBlock[];
};

// ============================================================================
// Stream Event Types (from Anthropic API)
// ============================================================================

export type MessageStartEvent = {
	type: "message_start";
	message: BetaMessage;
};

export type ContentBlockStartEvent = {
	type: "content_block_start";
	index: number;
	content_block: ContentBlock;
};

export type TextDelta = {
	type: "text_delta";
	text: string;
};

export type InputJsonDelta = {
	type: "input_json_delta";
	partial_json: string;
};

export type ThinkingDelta = {
	type: "thinking_delta";
	thinking: string;
};

export type ContentBlockDelta = {
	type: "content_block_delta";
	index: number;
	delta: TextDelta | InputJsonDelta | ThinkingDelta;
};

export type ContentBlockStopEvent = {
	type: "content_block_stop";
	index: number;
};

export type MessageDeltaEvent = {
	type: "message_delta";
	delta: {
		stop_reason: string | null;
		stop_sequence: string | null;
	};
	usage: BetaUsage;
	context_management?: {
		applied_edits: unknown[];
	};
};

export type MessageStopEvent = {
	type: "message_stop";
};

export type BetaRawMessageStreamEvent =
	| MessageStartEvent
	| ContentBlockStartEvent
	| ContentBlockDelta
	| ContentBlockStopEvent
	| MessageDeltaEvent
	| MessageStopEvent;

// ============================================================================
// Beta Message Types
// ============================================================================

export type BetaUsage = {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation?: {
		ephemeral_5m_input_tokens: number;
		ephemeral_1h_input_tokens: number;
	};
	service_tier?: string;
	inference_geo?: string;
	server_tool_use?: {
		web_search_requests: number;
		web_fetch_requests: number;
	};
};

export type BetaMessage = {
	id: string;
	type: "message";
	role: "assistant";
	model: string;
	content: ContentBlock[];
	stop_reason: string | null;
	stop_sequence: string | null;
	usage: BetaUsage;
	context_management?: {
		applied_edits: unknown[];
	} | null;
};

// ============================================================================
// SDK User Message (Input to CLI)
// ============================================================================

export type SDKUserMessage = {
	type: "user";
	message: MessageParam;
	parent_tool_use_id: string | null;
	isSynthetic?: boolean;
	tool_use_result?: unknown;
	uuid?: UUID;
	session_id: string;
};

// ============================================================================
// SDK Output Messages (Output from CLI)
// ============================================================================

export type ApiKeySource = "user" | "project" | "org" | "temporary" | "none";

export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan"
	| "delegate"
	| "dontAsk";

export type SDKSystemMessage = {
	type: "system";
	subtype: "init";
	agents?: string[];
	apiKeySource: ApiKeySource;
	betas?: string[];
	claude_code_version: string;
	cwd: string;
	tools: string[];
	mcp_servers: {
		name: string;
		status: string;
	}[];
	model: string;
	permissionMode: PermissionMode;
	slash_commands: string[];
	output_style: string;
	skills: string[];
	plugins: {
		name: string;
		path: string;
	}[];
	uuid: UUID;
	session_id: string;
};

export type SDKAssistantMessageError =
	| "authentication_failed"
	| "billing_error"
	| "rate_limit"
	| "invalid_request"
	| "server_error"
	| "unknown";

export type SDKAssistantMessage = {
	type: "assistant";
	message: BetaMessage;
	parent_tool_use_id: string | null;
	error?: SDKAssistantMessageError;
	uuid: UUID;
	session_id: string;
};

export type SDKPartialAssistantMessage = {
	type: "stream_event";
	event: BetaRawMessageStreamEvent;
	parent_tool_use_id: string | null;
	uuid: UUID;
	session_id: string;
};

export type ModelUsage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	webSearchRequests: number;
	costUSD: number;
	contextWindow: number;
	maxOutputTokens: number;
};

export type NonNullableUsage = {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	server_tool_use?: {
		web_search_requests: number;
		web_fetch_requests: number;
	};
	service_tier?: string;
	cache_creation?: {
		ephemeral_1h_input_tokens: number;
		ephemeral_5m_input_tokens: number;
	};
};

export type SDKPermissionDenial = {
	tool_name: string;
	tool_use_id: string;
	tool_input: Record<string, unknown>;
};

export type SDKResultSuccess = {
	type: "result";
	subtype: "success";
	duration_ms: number;
	duration_api_ms: number;
	is_error: boolean;
	num_turns: number;
	result: string;
	total_cost_usd: number;
	usage: NonNullableUsage;
	modelUsage: Record<string, ModelUsage>;
	permission_denials: SDKPermissionDenial[];
	structured_output?: unknown;
	uuid: UUID;
	session_id: string;
};

export type SDKResultError = {
	type: "result";
	subtype:
		| "error_during_execution"
		| "error_max_turns"
		| "error_max_budget_usd"
		| "error_max_structured_output_retries";
	duration_ms: number;
	duration_api_ms: number;
	is_error: boolean;
	num_turns: number;
	total_cost_usd: number;
	usage: NonNullableUsage;
	modelUsage: Record<string, ModelUsage>;
	permission_denials: SDKPermissionDenial[];
	errors: string[];
	uuid: UUID;
	session_id: string;
};

export type SDKResultMessage = SDKResultSuccess | SDKResultError;

export type SDKUserMessageReplay = {
	type: "user";
	message: MessageParam;
	parent_tool_use_id: string | null;
	isSynthetic?: boolean;
	tool_use_result?: unknown;
	uuid: UUID;
	session_id: string;
	isReplay: true;
};

export type SDKCompactBoundaryMessage = {
	type: "system";
	subtype: "compact_boundary";
	compact_metadata: {
		trigger: "manual" | "auto";
		pre_tokens: number;
	};
	uuid: UUID;
	session_id: string;
};

export type SDKStatus = "compacting" | null;

export type SDKStatusMessage = {
	type: "system";
	subtype: "status";
	status: SDKStatus;
	uuid: UUID;
	session_id: string;
};

export type SDKHookResponseMessage = {
	type: "system";
	subtype: "hook_response";
	hook_name: string;
	hook_event: string;
	stdout: string;
	stderr: string;
	exit_code?: number;
	uuid: UUID;
	session_id: string;
};

export type SDKToolProgressMessage = {
	type: "tool_progress";
	tool_use_id: string;
	tool_name: string;
	parent_tool_use_id: string | null;
	elapsed_time_seconds: number;
	uuid: UUID;
	session_id: string;
};

export type SDKAuthStatusMessage = {
	type: "auth_status";
	isAuthenticating: boolean;
	output: string[];
	error?: string;
	uuid: UUID;
	session_id: string;
};

export type SDKTaskNotificationMessage = {
	type: "system";
	subtype: "task_notification";
	task_id: string;
	status: "completed" | "failed" | "stopped";
	output_file: string;
	summary: string;
	uuid: UUID;
	session_id: string;
};

// Union of all output message types
export type SDKMessage =
	| SDKAssistantMessage
	| SDKUserMessage
	| SDKUserMessageReplay
	| SDKResultMessage
	| SDKSystemMessage
	| SDKPartialAssistantMessage
	| SDKCompactBoundaryMessage
	| SDKStatusMessage
	| SDKHookResponseMessage
	| SDKToolProgressMessage
	| SDKAuthStatusMessage
	| SDKTaskNotificationMessage;
