// Session context types and helpers for assistant/thread architecture

export type SessionType = "assistant" | "thread";

export type SessionStatus =
	| "idle"
	| "running"
	| "error"
	| "completed"
	| "stopped";

export type SessionContext = {
	sessionId: string;
	type: SessionType;
	status: SessionStatus;
	projectPath: string | null; // null for assistant, required for threads
	pid: number | null;
	startTime: number;
	// Thread-specific fields
	parentSession?: string; // ID of spawning assistant session
	task?: string; // Initial task prompt
};

// Create a new assistant session context
export function createAssistantSession(sessionId: string): SessionContext {
	return {
		sessionId,
		type: "assistant",
		status: "idle",
		projectPath: null,
		pid: null,
		startTime: Date.now(),
	};
}

// Create a new thread session context
export function createThreadSession(
	sessionId: string,
	projectPath: string,
	parentSession: string,
	task: string,
): SessionContext {
	return {
		sessionId,
		type: "thread",
		status: "idle",
		projectPath,
		pid: null,
		startTime: Date.now(),
		parentSession,
		task,
	};
}
