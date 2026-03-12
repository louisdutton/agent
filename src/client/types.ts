export type ToolStatus = "running" | "complete" | "error";

export type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolStatus;
	resultImages?: string[]; // Base64 data URLs from tool results (e.g., Playwright screenshots)
};

export type TaskSpawnStatus = "pending" | "running" | "completed" | "error";

export type SpawnedTask = {
	taskId: string;
	prompt: string;
	status: TaskSpawnStatus;
	projectPath?: string;
};

export type EventItem =
	| { type: "user"; id: string; content: string; images?: string[] }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] }
	| { type: "task_spawn"; id: string; task: SpawnedTask }
	| { type: "error"; id: string; message: string };

// Unified model for assistant sessions and background tasks
export type BackgroundTaskStatus =
	| "idle"
	| "running"
	| "completed"
	| "error"
	| "stopped";

export type BackgroundTask = {
	id: string;
	type: "assistant" | "task";
	projectPath: string;
	projectName: string;
	status: BackgroundTaskStatus;
	name: string; // First prompt for assistant, task description for background task
	startTime: number;
	// Background task-specific
	parentSession?: string;
	pid?: number | null;
};
