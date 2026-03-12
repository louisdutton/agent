// Wire protocol events - streamed to clients via SSE

export type SessionStatus =
	| "idle"
	| "running"
	| "waiting" // Needs approval
	| "completed"
	| "error";

export type ApprovalRequest = {
	id: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	description: string;
};

export type TaskSpawnStatus = "pending" | "running" | "completed" | "error";

export type WireEvent =
	| { type: "turn_begin"; sessionId: string; userMessage: string }
	| { type: "turn_end"; sessionId: string }
	| { type: "step_begin"; sessionId: string; step: number }
	| { type: "step_end"; sessionId: string; step: number }
	| { type: "text"; text: string }
	| { type: "text_done"; text: string }
	| { type: "tool_use_start"; id: string; name: string }
	| { type: "tool_use_delta"; id: string; input: string }
	| { type: "tool_use_end"; id: string; name: string; input: unknown }
	| {
			type: "tool_result";
			toolCallId: string;
			content: string;
			isError?: boolean;
	  }
	| { type: "status"; sessionId: string; status: SessionStatus }
	| { type: "approval_needed"; sessionId: string; request: ApprovalRequest }
	| {
			type: "approval_resolved";
			sessionId: string;
			requestId: string;
			approved: boolean;
	  }
	| { type: "error"; sessionId: string; error: string }
	| {
			type: "usage";
			inputTokens: number;
			outputTokens: number;
			cacheRead?: number;
			cacheWrite?: number;
	  }
	| {
			type: "task_spawn";
			taskId: string;
			prompt: string;
			status: TaskSpawnStatus;
			projectPath?: string;
	  };

// Notification events (pushed via WS to all clients)
export type NotificationEvent =
	| {
			type: "session_status";
			sessionId: string;
			projectPath: string;
			status: SessionStatus;
			title?: string;
	  }
	| {
			type: "approval_needed";
			sessionId: string;
			projectPath: string;
			request: ApprovalRequest;
	  }
	| {
			type: "session_error";
			sessionId: string;
			projectPath: string;
			error: string;
	  };
