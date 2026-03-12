// Assistant manager - persistent orchestrator with evolving memory

import { randomUUID } from "node:crypto";
import { getMemoryStore, type MemoryStore } from "./memory";
import type {
	Assistant,
	AssistantConfig,
	MemoryEntry,
	TaskContext,
	TaskOutcome,
} from "./types";

export class AssistantManager {
	private assistant: Assistant;
	private memory: MemoryStore;

	constructor(config: AssistantConfig = {}) {
		this.assistant = {
			id: randomUUID(),
			createdAt: Date.now(),
			config,
		};
		this.memory = getMemoryStore();
	}

	async initialize(): Promise<void> {
		await this.memory.load();
	}

	getAssistant(): Assistant {
		return this.assistant;
	}

	/**
	 * Build context for a spawned task with relevant memory entries
	 */
	async buildTaskContext(
		prompt: string,
		options: {
			tags?: string[];
			parentTaskId?: string;
			spawnedBy?: TaskContext["spawnedBy"];
		} = {},
	): Promise<TaskContext> {
		// Extract keywords from prompt for memory search
		const keywords = this.extractKeywords(prompt);

		// Query relevant memory entries
		const memory = await this.memory.query({
			keywords,
			tags: options.tags,
			limit: 10,
		});

		// Build system prompt with injected memory
		const systemPrompt = this.buildSystemPrompt(prompt, memory);

		return {
			systemPrompt,
			memory,
			parentTaskId: options.parentTaskId,
			spawnedBy: options.spawnedBy || "assistant",
		};
	}

	/**
	 * Process outcome from a completed task, extract and store learnings
	 */
	async processOutcome(outcome: TaskOutcome): Promise<void> {
		if (outcome.learnings?.length) {
			for (const learning of outcome.learnings) {
				await this.memory.add("pattern", learning, {
					context: `Task ${outcome.taskId}: ${outcome.summary}`,
					tags: ["task-learning"],
				});
			}
		}
	}

	/**
	 * Store a correction from user feedback
	 */
	async addCorrection(
		content: string,
		context?: string,
		tags?: string[],
	): Promise<MemoryEntry> {
		return this.memory.add("correction", content, {
			context,
			tags: tags || ["user-feedback"],
		});
	}

	/**
	 * Store a user preference
	 */
	async addPreference(
		content: string,
		context?: string,
		tags?: string[],
	): Promise<MemoryEntry> {
		return this.memory.add("preference", content, {
			context,
			tags,
		});
	}

	/**
	 * Store a learned pattern
	 */
	async addPattern(
		content: string,
		context?: string,
		tags?: string[],
	): Promise<MemoryEntry> {
		return this.memory.add("pattern", content, {
			context,
			tags,
		});
	}

	/**
	 * Query memory for relevant entries
	 */
	async getRelevantMemory(query: string, limit = 10): Promise<MemoryEntry[]> {
		const keywords = this.extractKeywords(query);
		return this.memory.query({ keywords, limit });
	}

	/**
	 * Get all memory entries (for debugging/display)
	 */
	async getAllMemory(): Promise<MemoryEntry[]> {
		return this.memory.getAll();
	}

	/**
	 * Remove a memory entry
	 */
	async removeMemory(id: string): Promise<boolean> {
		return this.memory.remove(id);
	}

	private extractKeywords(text: string): string[] {
		// Simple keyword extraction - split on whitespace, filter short words
		const stopWords = new Set([
			"the",
			"a",
			"an",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"being",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"must",
			"can",
			"to",
			"of",
			"in",
			"for",
			"on",
			"with",
			"at",
			"by",
			"from",
			"as",
			"into",
			"through",
			"during",
			"before",
			"after",
			"above",
			"below",
			"between",
			"under",
			"again",
			"further",
			"then",
			"once",
			"here",
			"there",
			"when",
			"where",
			"why",
			"how",
			"all",
			"each",
			"few",
			"more",
			"most",
			"other",
			"some",
			"such",
			"no",
			"nor",
			"not",
			"only",
			"own",
			"same",
			"so",
			"than",
			"too",
			"very",
			"just",
			"and",
			"but",
			"if",
			"or",
			"because",
			"until",
			"while",
			"this",
			"that",
			"these",
			"those",
			"it",
			"its",
			"i",
			"me",
			"my",
			"you",
			"your",
			"he",
			"him",
			"his",
			"she",
			"her",
			"we",
			"us",
			"our",
			"they",
			"them",
			"their",
			"what",
			"which",
			"who",
			"whom",
		]);

		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, " ")
			.split(/\s+/)
			.filter((word) => word.length > 2 && !stopWords.has(word))
			.slice(0, 10); // Limit to 10 keywords
	}

	private buildSystemPrompt(_prompt: string, memory: MemoryEntry[]): string {
		const basePrompt = this.assistant.config.systemPrompt || "";

		if (memory.length === 0) {
			return basePrompt;
		}

		const memorySection = memory
			.map((e) => {
				const prefix =
					e.type === "correction"
						? "[Correction]"
						: e.type === "preference"
							? "[Preference]"
							: "[Pattern]";
				return `${prefix} ${e.content}`;
			})
			.join("\n");

		return `${basePrompt}

## Relevant Context from Memory

${memorySection}

---
Use the above context to inform your approach. Apply any corrections or preferences where relevant.`;
	}
}

// Singleton instance
let instance: AssistantManager | null = null;

export function getAssistantManager(): AssistantManager {
	if (!instance) {
		instance = new AssistantManager();
	}
	return instance;
}

export async function initAssistant(): Promise<AssistantManager> {
	const manager = getAssistantManager();
	await manager.initialize();
	return manager;
}
