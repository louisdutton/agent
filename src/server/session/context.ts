// Session context types and helpers for assistant/worker architecture

export type SessionType = "assistant" | "worker";

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
	projectPath: string | null; // null for assistant, required for workers
	pid: number | null;
	startTime: number;
	// Worker-specific fields
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

// Create a new worker session context
export function createWorkerSession(
	sessionId: string,
	projectPath: string,
	parentSession: string,
	task: string,
): SessionContext {
	return {
		sessionId,
		type: "worker",
		status: "idle",
		projectPath,
		pid: null,
		startTime: Date.now(),
		parentSession,
		task,
	};
}
