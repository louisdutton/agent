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

// Unified thread model - both assistant sessions and workers are threads
export type ThreadStatus =
	| "idle"
	| "running"
	| "completed"
	| "error"
	| "stopped";

export type Thread = {
	id: string;
	type: "assistant" | "worker";
	projectPath: string;
	projectName: string;
	status: ThreadStatus;
	name: string; // First prompt for assistant, task for worker
	startTime: number;
	// Worker-specific
	parentSession?: string;
	pid?: number | null;
};
