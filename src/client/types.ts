export type ToolStatus = "running" | "complete" | "error";

export type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolStatus;
	resultImages?: string[]; // Base64 data URLs from tool results (e.g., Playwright screenshots)
};

export type EventItem =
	| { type: "user"; id: string; content: string; images?: string[] }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] }
	| { type: "error"; id: string; message: string };

// Unified thread model - assistant and background threads
export type ThreadStatus =
	| "idle"
	| "running"
	| "completed"
	| "error"
	| "stopped";

export type Thread = {
	id: string;
	type: "assistant" | "worker"; // worker = background thread
	projectPath: string;
	projectName: string;
	status: ThreadStatus;
	name: string; // First prompt for assistant, task for background thread
	startTime: number;
	// Background thread-specific
	parentSession?: string;
	pid?: number | null;
};
