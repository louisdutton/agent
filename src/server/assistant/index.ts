// Assistant module exports

export {
	AssistantManager,
	getAssistantManager,
	initAssistant,
} from "./assistant";
export {
	buildTaskSystemPrompt,
	createMinimalContext,
	extractLearnings,
	generateOutcomeSummary,
} from "./context";
export { getMemoryStore, MemoryStore } from "./memory";
export type {
	Assistant,
	AssistantConfig,
	MemoryEntry,
	TaskContext,
	TaskOutcome,
} from "./types";
