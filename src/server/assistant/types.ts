// Assistant and memory types

export type Assistant = {
	id: string;
	createdAt: number;
	config: AssistantConfig;
};

export type AssistantConfig = {
	name?: string;
	systemPrompt?: string;
};

export type MemoryEntry = {
	id: string;
	type: "correction" | "preference" | "pattern";
	content: string;
	context?: string;
	createdAt: number;
	tags?: string[];
};

export type TaskOutcome = {
	taskId: string;
	status: "completed" | "error";
	summary: string;
	learnings?: string[];
};

export type TaskContext = {
	systemPrompt: string;
	memory: MemoryEntry[];
	parentTaskId?: string;
	spawnedBy: "assistant" | "user" | "trigger";
};
