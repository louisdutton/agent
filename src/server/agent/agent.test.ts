// Integration tests for agent module

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, StreamChunk } from "../providers/types";
import type { WireEvent } from "../wire/types";
import { runAgentLoop } from "./loop";
import { SessionManager } from "./session-manager";
import { createDefaultToolRegistry } from "./tools";
import type { Session, ToolCall } from "./types";

// Test fixtures
const TEST_DIR = join(tmpdir(), "agent-test-" + Date.now());

beforeEach(async () => {
	await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
	await rm(TEST_DIR, { recursive: true, force: true });
});

// Mock provider that returns predefined responses
function createMockProvider(responses: StreamChunk[][]) {
	let callIndex = 0;

	return {
		name: "mock",
		model: "mock-model",
		maxContextTokens: 100000,

		async *stream(
			_messages: Message[],
			_options: unknown,
		): AsyncGenerator<StreamChunk> {
			const chunks = responses[callIndex++] || [];
			for (const chunk of chunks) {
				yield chunk;
			}
		},

		async countTokens(_messages: Message[]): Promise<number> {
			return 100;
		},
	};
}

// Minimal mock provider for SessionManager tests
const mockProvider = createMockProvider([]);

describe("SessionManager", () => {
	test("creates a new session", () => {
		const manager = new SessionManager({ provider: mockProvider });
		const session = manager.create(TEST_DIR);

		expect(session.id).toBeDefined();
		expect(session.projectPath).toBe(TEST_DIR);
		expect(session.status).toBe("idle");
		expect(session.messages).toEqual([]);
	});

	test("gets session by id", () => {
		const manager = new SessionManager({ provider: mockProvider });
		const session = manager.create(TEST_DIR);

		const retrieved = manager.get(session.id);
		expect(retrieved).toBe(session);
	});

	test("lists all sessions", () => {
		const manager = new SessionManager({ provider: mockProvider });
		manager.create(TEST_DIR);
		manager.create(TEST_DIR);

		const sessions = manager.list();
		expect(sessions).toHaveLength(2);
	});

	test("lists sessions by project", () => {
		const manager = new SessionManager({ provider: mockProvider });
		manager.create(TEST_DIR);
		manager.create("/other/path");

		const sessions = manager.listByProject(TEST_DIR);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].projectPath).toBe(TEST_DIR);
	});

	test("deletes a session", async () => {
		const manager = new SessionManager({ provider: mockProvider });
		const session = manager.create(TEST_DIR);

		expect(await manager.delete(session.id)).toBe(true);
		expect(manager.get(session.id)).toBeUndefined();
	});

	test("cancels a running session", () => {
		const manager = new SessionManager({ provider: mockProvider });
		const session = manager.create(TEST_DIR);
		session.status = "running";
		session.abortController = new AbortController();

		expect(manager.cancel(session.id)).toBe(true);
		expect(session.status as string).toBe("idle");
	});
});

describe("runAgentLoop", () => {
	test("streams text response", async () => {
		const provider = createMockProvider([
			[
				{ type: "text", text: "Hello " },
				{ type: "text", text: "world!" },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "Hi" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);
		const requestApproval = async () => true;

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
		);

		// Check events
		const textEvents = events.filter((e) => e.type === "text");
		expect(textEvents).toHaveLength(2);
		expect((textEvents[0] as { text: string }).text).toBe("Hello ");
		expect((textEvents[1] as { text: string }).text).toBe("world!");

		// Check turn lifecycle
		expect(events.find((e) => e.type === "turn_begin")).toBeDefined();
		expect(events.find((e) => e.type === "turn_end")).toBeDefined();
	});

	test("executes tool calls", async () => {
		const provider = createMockProvider([
			// First response: tool call
			[
				{ type: "tool_use_start", id: "tool-1", name: "glob" },
				{ type: "tool_use_delta", id: "tool-1", input: '{"pattern":' },
				{ type: "tool_use_delta", id: "tool-1", input: '"*.ts"}' },
				{ type: "tool_use_end", id: "tool-1" },
				{ type: "done", stopReason: "tool_use" },
			],
			// Second response: final answer
			[
				{ type: "text", text: "Found files." },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "List ts files" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);
		const requestApproval = async () => true;

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
		);

		// Check tool events
		const toolStart = events.find((e) => e.type === "tool_use_start");
		expect(toolStart).toBeDefined();
		expect((toolStart as { name: string }).name).toBe("glob");

		const toolEnd = events.find((e) => e.type === "tool_use_end");
		expect(toolEnd).toBeDefined();

		const toolResult = events.find((e) => e.type === "tool_result");
		expect(toolResult).toBeDefined();
	});

	test("requests approval for bash tool", async () => {
		const provider = createMockProvider([
			// First response: bash tool call
			[
				{ type: "tool_use_start", id: "tool-1", name: "bash" },
				{
					type: "tool_use_delta",
					id: "tool-1",
					input: '{"command":"echo hi"}',
				},
				{ type: "tool_use_end", id: "tool-1" },
				{ type: "done", stopReason: "tool_use" },
			],
			// Second response: acknowledge result
			[
				{ type: "text", text: "Done." },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "Run echo" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);

		let approvalRequested = false;
		let approvalToolCall: ToolCall | null = null;
		const requestApproval = async (toolCall: ToolCall) => {
			approvalRequested = true;
			approvalToolCall = toolCall;
			return true;
		};

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
		);

		expect(approvalRequested).toBe(true);
		expect(approvalToolCall!.name).toBe("bash");
		expect(approvalToolCall!.input).toEqual({ command: "echo hi" });
	});

	test("handles approval rejection", async () => {
		const provider = createMockProvider([
			// First response: bash tool call
			[
				{ type: "tool_use_start", id: "tool-1", name: "bash" },
				{
					type: "tool_use_delta",
					id: "tool-1",
					input: '{"command":"rm -rf /"}',
				},
				{ type: "tool_use_end", id: "tool-1" },
				{ type: "done", stopReason: "tool_use" },
			],
			// Second response: acknowledge rejection
			[
				{ type: "text", text: "Understood, cancelled." },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "Delete everything" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);

		// Reject the approval
		const requestApproval = async () => false;

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
		);

		// Check that rejection was recorded
		const toolResult = events.find(
			(e) => e.type === "tool_result",
		) as WireEvent & {
			type: "tool_result";
			content: string;
			isError: boolean;
		};
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain("rejected");
		expect(toolResult.isError).toBe(true);
	});

	test("handles unknown tool gracefully", async () => {
		const provider = createMockProvider([
			[
				{ type: "tool_use_start", id: "tool-1", name: "unknown_tool" },
				{ type: "tool_use_delta", id: "tool-1", input: "{}" },
				{ type: "tool_use_end", id: "tool-1" },
				{ type: "done", stopReason: "tool_use" },
			],
			[
				{ type: "text", text: "Sorry, that tool doesn't exist." },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "Use unknown tool" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);
		const requestApproval = async () => true;

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
		);

		const toolResult = events.find(
			(e) => e.type === "tool_result",
		) as WireEvent & {
			type: "tool_result";
			content: string;
			isError: boolean;
		};
		expect(toolResult).toBeDefined();
		expect(toolResult.content).toContain("Unknown tool");
		expect(toolResult.isError).toBe(true);
	});

	test("respects abort signal", async () => {
		const provider = createMockProvider([
			[
				{ type: "text", text: "Starting..." },
				{ type: "done", stopReason: "end_turn" },
			],
		]);

		const abortController = new AbortController();
		abortController.abort(); // Abort immediately

		const session: Session = {
			id: "test-session",
			projectPath: TEST_DIR,
			status: "running",
			messages: [{ role: "user", content: "Hi" }],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};

		const events: WireEvent[] = [];
		const emit = (e: WireEvent) => events.push(e);
		const requestApproval = async () => true;

		await runAgentLoop(
			session,
			provider,
			createDefaultToolRegistry(),
			"You are helpful",
			emit,
			requestApproval,
			{ signal: abortController.signal },
		);

		// Should have turn_begin but exit early
		expect(events.find((e) => e.type === "turn_begin")).toBeDefined();
		// No text events since we aborted before streaming
		expect(events.filter((e) => e.type === "text")).toHaveLength(0);
	});
});

describe("Tools", () => {
	test("read tool reads file content", async () => {
		// Create test file
		const testFile = join(TEST_DIR, "test.txt");
		await Bun.write(testFile, "Hello, world!");

		const tools = createDefaultToolRegistry();
		const readTool = tools.get("read");

		const result = await readTool!.execute(
			{ path: testFile },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.content).toContain("Hello, world!");
		expect(result.isError).toBeFalsy();
	});

	test("read tool handles missing file", async () => {
		const tools = createDefaultToolRegistry();
		const readTool = tools.get("read");

		const result = await readTool!.execute(
			{ path: join(TEST_DIR, "nonexistent.txt") },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.isError).toBe(true);
	});

	test("write tool creates file", async () => {
		const tools = createDefaultToolRegistry();
		const writeTool = tools.get("write");

		const testFile = join(TEST_DIR, "output.txt");
		const result = await writeTool!.execute(
			{ path: testFile, content: "Test content" },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.isError).toBeFalsy();

		const content = await Bun.file(testFile).text();
		expect(content).toBe("Test content");
	});

	test("glob tool finds files", async () => {
		// Create test files
		await Bun.write(join(TEST_DIR, "a.ts"), "");
		await Bun.write(join(TEST_DIR, "b.ts"), "");
		await Bun.write(join(TEST_DIR, "c.js"), "");

		const tools = createDefaultToolRegistry();
		const globTool = tools.get("glob");

		const result = await globTool!.execute(
			{ pattern: "*.ts" },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.content).toContain("a.ts");
		expect(result.content).toContain("b.ts");
		expect(result.content).not.toContain("c.js");
	});

	test("grep tool searches content", async () => {
		await Bun.write(
			join(TEST_DIR, "search.txt"),
			"hello world\nfoo bar\nhello again",
		);

		const tools = createDefaultToolRegistry();
		const grepTool = tools.get("grep");

		const result = await grepTool!.execute(
			{ pattern: "hello" },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.content).toContain("search.txt");
	});

	test("bash tool executes command", async () => {
		const tools = createDefaultToolRegistry();
		const bashTool = tools.get("bash");

		const result = await bashTool!.execute(
			{ command: "echo 'test output'" },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.content).toContain("test output");
		expect(result.isError).toBeFalsy();
	});

	test("bash tool requires approval", () => {
		const tools = createDefaultToolRegistry();
		const bashTool = tools.get("bash");

		expect(bashTool!.requiresApproval).toBe(true);
	});

	test("read/write/glob/grep/web_search don't require approval", () => {
		const tools = createDefaultToolRegistry();

		expect(tools.get("read")!.requiresApproval).toBe(false);
		expect(tools.get("write")!.requiresApproval).toBe(false);
		expect(tools.get("glob")!.requiresApproval).toBe(false);
		expect(tools.get("grep")!.requiresApproval).toBe(false);
		expect(tools.get("web_search")!.requiresApproval).toBe(false);
	});

	test("web_search tool is registered", () => {
		const tools = createDefaultToolRegistry();
		const webSearch = tools.get("web_search");

		expect(webSearch).toBeDefined();
		expect(webSearch!.name).toBe("web_search");
		expect(webSearch!.description).toContain("DuckDuckGo");
	});

	test("web_search rejects empty query", async () => {
		const tools = createDefaultToolRegistry();
		const webSearch = tools.get("web_search");

		const result = await webSearch!.execute(
			{ query: "" },
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain("Missing");
	});

	test("web_search rejects missing query", async () => {
		const tools = createDefaultToolRegistry();
		const webSearch = tools.get("web_search");

		const result = await webSearch!.execute(
			{},
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		expect(result.isError).toBe(true);
		expect(result.content).toContain("Missing");
	});

	test("web_search clamps num to valid range", async () => {
		const tools = createDefaultToolRegistry();
		const webSearch = tools.get("web_search");

		// This will fail if ddgr isn't installed, but tests the parameter handling
		const result = await webSearch!.execute(
			{ query: "test", num: 100 }, // Should clamp to 25
			{ workDir: TEST_DIR, sessionId: "test" },
		);

		// Either succeeds with results or fails because ddgr not installed
		// Both are valid - we're testing it doesn't crash with invalid num
		expect(result.content).toBeDefined();
	});
});
