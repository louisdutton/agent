// Agent core types

import type { Message } from "../providers/types";
import type { ApprovalRequest, SessionStatus } from "../wire/types";

export type Session = {
	id: string;
	projectPath: string;
	status: SessionStatus;
	messages: Message[];
	createdAt: number;
	updatedAt: number;
	title?: string;

	// Runtime state (not persisted)
	abortController?: AbortController;
	pendingApproval?: ApprovalRequest;
	approvalResolver?: (approved: boolean) => void;
};

export type ToolContext = {
	workDir: string;
	sessionId: string;
	signal?: AbortSignal;
};

export type ToolResult = {
	content: string;
	isError?: boolean;
};

export type Tool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	requiresApproval: boolean;
	execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

export type ToolCall = {
	id: string;
	name: string;
	input: unknown;
};

export type AgentConfig = {
	model?: string;
	maxStepsPerTurn?: number;
	contextCompactionThreshold?: number; // 0-1, default 0.5
	systemPrompt?: string;
	tools?: {
		[name: string]: { requiresApproval?: boolean };
	};
};
