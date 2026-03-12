// Tests for assistant module

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildTaskSystemPrompt,
	extractLearnings,
	generateOutcomeSummary,
} from "./context";
import { MemoryStore } from "./memory";

// Use unique dir per test run
let testDir: string;

beforeEach(async () => {
	testDir = join(tmpdir(), `assistant-test-${Date.now()}-${Math.random()}`);
	await mkdir(testDir, { recursive: true });
	// Set env to use test directory
	process.env.XDG_DATA_HOME = testDir;
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
	delete process.env.XDG_DATA_HOME;
});

describe("MemoryStore", () => {
	test("adds and queries memory entries", async () => {
		const store = new MemoryStore();
		await store.load();

		await store.add("correction", "Always use TypeScript strict mode", {
			tags: ["typescript"],
		});
		await store.add("preference", "Prefer functional components", {
			tags: ["react"],
		});

		const all = await store.getAll();
		expect(all.length).toBe(2);

		const corrections = await store.query({ type: "correction" });
		expect(corrections.length).toBe(1);
		expect(corrections[0].content).toBe("Always use TypeScript strict mode");

		const tsEntries = await store.query({ tags: ["typescript"] });
		expect(tsEntries.length).toBe(1);
	});

	test("queries by keywords", async () => {
		const store = new MemoryStore();
		await store.load();

		await store.add("pattern", "Use async/await instead of callbacks");
		await store.add("pattern", "Handle errors with try/catch");

		const asyncResults = await store.query({ keywords: ["async", "await"] });
		expect(asyncResults.length).toBe(1);
		expect(asyncResults[0].content).toContain("async/await");
	});

	test("removes entries", async () => {
		const store = new MemoryStore();
		await store.load();

		const initialCount = (await store.getAll()).length;
		const entry = await store.add("correction", "Test entry to remove");

		expect((await store.getAll()).length).toBe(initialCount + 1);

		const removed = await store.remove(entry.id);
		expect(removed).toBe(true);
		expect((await store.getAll()).length).toBe(initialCount);
	});

	test("returns false when removing non-existent entry", async () => {
		const store = new MemoryStore();
		await store.load();

		const removed = await store.remove("non-existent-id");
		expect(removed).toBe(false);
	});

	test("limits query results", async () => {
		const store = new MemoryStore();
		await store.load();

		for (let i = 0; i < 10; i++) {
			await store.add("pattern", `Pattern ${i}`);
		}

		const limited = await store.query({ limit: 3 });
		expect(limited.length).toBe(3);
	});
});

describe("Context Builder", () => {
	test("builds system prompt with memory", () => {
		const memory = [
			{
				id: "1",
				type: "correction" as const,
				content: "Use strict null checks",
				createdAt: Date.now(),
			},
			{
				id: "2",
				type: "preference" as const,
				content: "Prefer named exports",
				createdAt: Date.now(),
			},
		];

		const prompt = buildTaskSystemPrompt(
			"Base prompt",
			memory,
			"Write a function",
		);

		expect(prompt).toContain("Base prompt");
		expect(prompt).toContain("Important Corrections");
		expect(prompt).toContain("Use strict null checks");
		expect(prompt).toContain("User Preferences");
		expect(prompt).toContain("Prefer named exports");
		expect(prompt).toContain("Write a function");
	});

	test("handles empty memory", () => {
		const prompt = buildTaskSystemPrompt("Base prompt", [], "Do something");

		expect(prompt).toContain("Base prompt");
		expect(prompt).toContain("Do something");
		expect(prompt).not.toContain("Corrections");
	});

	test("extracts learnings from messages", () => {
		const messages = [
			"I learned that async functions always return promises",
			"You should validate user input",
			"The function completed successfully",
			"Important: never commit API keys",
		];

		const learnings = extractLearnings(messages);

		expect(learnings).toContain("async functions always return promises");
		expect(learnings).toContain("validate user input");
		expect(learnings).toContain("never commit API keys");
		expect(learnings.length).toBe(3);
	});

	test("generates outcome summary", () => {
		const summary = generateOutcomeSummary(
			"Fix the login bug",
			"Fixed the authentication flow by updating the token validation",
			"completed",
		);

		expect(summary).toContain("Fix the login bug");
		expect(summary).toContain("completed");
		expect(summary).toContain("Fixed the authentication flow");
	});

	test("truncates long prompts in summary", () => {
		const longPrompt = "A".repeat(200);
		const summary = generateOutcomeSummary(longPrompt, "Done", "completed");

		expect(summary.length).toBeLessThan(400);
		expect(summary).toContain("...");
	});

	test("generates summary for error status", () => {
		const summary = generateOutcomeSummary("Deploy app", "", "error");

		expect(summary).toContain("failed");
		expect(summary).toContain("Deploy app");
	});
});
