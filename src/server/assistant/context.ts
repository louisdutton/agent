// Context builder - constructs focused context for spawned tasks

import type { MemoryEntry, TaskContext } from "./types";

/**
 * Build a focused system prompt for a task, injecting relevant memory
 */
export function buildTaskSystemPrompt(
	basePrompt: string,
	memory: MemoryEntry[],
	taskPrompt: string,
): string {
	const parts: string[] = [];

	// Base system prompt
	if (basePrompt) {
		parts.push(basePrompt);
	}

	// Inject relevant memory as context
	if (memory.length > 0) {
		const corrections = memory.filter((e) => e.type === "correction");
		const preferences = memory.filter((e) => e.type === "preference");
		const patterns = memory.filter((e) => e.type === "pattern");

		const memoryParts: string[] = [];

		if (corrections.length > 0) {
			memoryParts.push("## Important Corrections\n");
			for (const c of corrections) {
				memoryParts.push(`- ${c.content}`);
			}
			memoryParts.push("");
		}

		if (preferences.length > 0) {
			memoryParts.push("## User Preferences\n");
			for (const p of preferences) {
				memoryParts.push(`- ${p.content}`);
			}
			memoryParts.push("");
		}

		if (patterns.length > 0) {
			memoryParts.push("## Learned Patterns\n");
			for (const p of patterns) {
				memoryParts.push(`- ${p.content}`);
			}
			memoryParts.push("");
		}

		if (memoryParts.length > 0) {
			parts.push("---\n# Context from Assistant Memory\n");
			parts.push(memoryParts.join("\n"));
		}
	}

	// Task-specific instructions
	parts.push("---\n# Task\n");
	parts.push(taskPrompt);

	return parts.join("\n\n");
}

/**
 * Extract potential learnings from task messages
 */
export function extractLearnings(messages: string[]): string[] {
	const learnings: string[] = [];

	// Look for patterns that indicate learnings
	const learningPatterns = [
		/learned that (.+)/i,
		/should (?:always |never )?(.+)/i,
		/remember to (.+)/i,
		/important: (.+)/i,
		/note: (.+)/i,
		/correction: (.+)/i,
	];

	for (const msg of messages) {
		for (const pattern of learningPatterns) {
			const match = msg.match(pattern);
			if (match?.[1]) {
				learnings.push(match[1].trim());
			}
		}
	}

	return learnings;
}

/**
 * Generate a summary from task outcome
 */
export function generateOutcomeSummary(
	taskPrompt: string,
	finalMessage: string,
	status: "completed" | "error",
): string {
	const statusText = status === "completed" ? "completed" : "failed";
	const truncatedPrompt =
		taskPrompt.length > 100 ? taskPrompt.slice(0, 100) + "..." : taskPrompt;

	if (finalMessage) {
		const truncatedResult =
			finalMessage.length > 200
				? finalMessage.slice(0, 200) + "..."
				: finalMessage;
		return `Task "${truncatedPrompt}" ${statusText}. Result: ${truncatedResult}`;
	}

	return `Task "${truncatedPrompt}" ${statusText}.`;
}

/**
 * Create a minimal task context (no memory injection)
 */
export function createMinimalContext(
	spawnedBy: TaskContext["spawnedBy"],
	parentTaskId?: string,
): TaskContext {
	return {
		systemPrompt: "",
		memory: [],
		parentTaskId,
		spawnedBy,
	};
}
