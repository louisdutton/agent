// Background thread management - spawning, stopping, and streaming output

import { randomUUID } from "node:crypto";
import { type Subprocess, spawn } from "bun";
import type { SDKMessage } from "../claude/claude-cli-types";
import type { SessionContext } from "./context";
import {
	canSpawnThread,
	markSessionCompleted,
	markSessionError,
	markSessionRunning,
	markSessionStopped,
	startThread as registerThread,
} from "./store";

// Event types for thread streams
export type ThreadEvent =
	| SDKMessage
	| { type: "done" }
	| { type: "error"; error: string };

// Thread state with event buffer for replay
type ThreadState = {
	proc: Subprocess<"pipe", "pipe", "pipe"> | null;
	subscribers: Set<(event: ThreadEvent) => void>;
	eventBuffer: ThreadEvent[];
	status: "running" | "completed" | "error" | "stopped";
	maxBufferSize: number;
};

// Active threads (keyed by threadId)
const threads = new Map<string, ThreadState>();

// Check if a directory has a flake.nix
async function hasFlake(dir: string): Promise<boolean> {
	const file = Bun.file(`${dir}/flake.nix`);
	return file.exists();
}

// Emit event to all subscribers and buffer it
function emitEvent(threadId: string, event: ThreadEvent): void {
	const thread = threads.get(threadId);
	if (!thread) return;

	// Add to buffer (with size limit)
	if (thread.eventBuffer.length >= thread.maxBufferSize) {
		thread.eventBuffer.shift();
	}
	thread.eventBuffer.push(event);

	// Notify all subscribers
	for (const callback of thread.subscribers) {
		try {
			callback(event);
		} catch (err) {
			console.error("Subscriber callback error:", err);
		}
	}
}

// Spawn a new background thread
export async function spawnThread(
	projectPath: string,
	task: string,
	parentSession: string,
): Promise<
	| { session: SessionContext; error?: undefined }
	| { session?: undefined; error: string }
> {
	if (!canSpawnThread()) {
		return { error: "Maximum number of threads reached" };
	}

	const threadId = `thread-${randomUUID().slice(0, 8)}`;
	const session = registerThread(threadId, projectPath, parentSession, task);
	if (!session) {
		return { error: "Failed to register thread" };
	}

	// Initialize thread state with buffer
	const threadState: ThreadState = {
		proc: null,
		subscribers: new Set(),
		eventBuffer: [],
		status: "running",
		maxBufferSize: 1000,
	};
	threads.set(threadId, threadState);

	try {
		const useNix = await hasFlake(projectPath);
		const command = useNix
			? [
					"nix",
					"develop",
					"--command",
					"claude",
					"-p",
					"--output-format",
					"stream-json",
					"--verbose",
					"--permission-mode",
					"bypassPermissions",
					"--dangerously-skip-permissions",
					"--include-partial-messages",
					task,
				]
			: [
					"claude",
					"-p",
					"--output-format",
					"stream-json",
					"--verbose",
					"--permission-mode",
					"bypassPermissions",
					"--dangerously-skip-permissions",
					"--include-partial-messages",
					task,
				];

		const proc = spawn(command, {
			cwd: projectPath,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
		});

		proc.stdin.end();
		threadState.proc = proc;
		markSessionRunning(threadId, proc.pid);

		// Start processing output
		processThreadOutput(threadId);

		return { session };
	} catch (err) {
		threadState.status = "error";
		markSessionError(threadId);
		emitEvent(threadId, { type: "error", error: String(err) });
		return { error: String(err) };
	}
}

// Process thread output and emit events
async function processThreadOutput(threadId: string): Promise<void> {
	const thread = threads.get(threadId);
	if (!thread?.proc) return;

	const { proc } = thread;
	const decoder = new TextDecoder();
	const reader = proc.stdout.getReader();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			const result = Bun.JSONL.parseChunk(buffer);
			for (const event of result.values as SDKMessage[]) {
				emitEvent(threadId, event);
			}
			buffer = buffer.slice(result.read);
		}

		// Process remaining buffer
		if (buffer.trim()) {
			const result = Bun.JSONL.parseChunk(buffer);
			for (const event of result.values as SDKMessage[]) {
				emitEvent(threadId, event);
			}
		}

		const exitCode = await proc.exited;

		if (exitCode === 0) {
			thread.status = "completed";
			markSessionCompleted(threadId);
		} else {
			const stderr = await new Response(proc.stderr).text();
			console.error(`Thread ${threadId} exited with code ${exitCode}:`, stderr);
			thread.status = "error";
			markSessionError(threadId);
		}

		emitEvent(threadId, { type: "done" });
	} catch (err) {
		console.error(`Thread ${threadId} error:`, err);
		thread.status = "error";
		markSessionError(threadId);
		emitEvent(threadId, { type: "error", error: String(err) });
	} finally {
		thread.proc = null;
	}
}

// Subscribe to thread events with replay support
export function subscribeToThread(
	threadId: string,
	callback: (event: ThreadEvent) => void,
	options: { replay?: boolean } = {},
): () => void {
	const thread = threads.get(threadId);

	if (!thread) {
		callback({ type: "error", error: "Thread not found" });
		return () => {};
	}

	// Replay buffered events if requested (default: true)
	const shouldReplay = options.replay !== false;
	if (shouldReplay && thread.eventBuffer.length > 0) {
		for (const event of thread.eventBuffer) {
			try {
				callback(event);
			} catch (err) {
				console.error("Replay callback error:", err);
			}
		}
	}

	// If already done, don't add to subscribers
	if (thread.status !== "running") {
		// Send final status if not already in buffer
		const lastEvent = thread.eventBuffer[thread.eventBuffer.length - 1];
		if (
			!lastEvent ||
			(lastEvent.type !== "done" && lastEvent.type !== "error")
		) {
			callback({ type: "done" });
		}
		return () => {};
	}

	// Add to live subscribers
	thread.subscribers.add(callback);

	return () => {
		thread.subscribers.delete(callback);
	};
}

// Stop a thread
export function stopThread(threadId: string): boolean {
	const thread = threads.get(threadId);
	if (!thread) return false;

	try {
		if (thread.proc) {
			thread.proc.kill("SIGTERM");
		}
		thread.status = "stopped";
		markSessionStopped(threadId);
		emitEvent(threadId, { type: "done" });
		return true;
	} catch (err) {
		console.error(`Failed to stop thread ${threadId}:`, err);
		return false;
	}
}

// Inject a message into a running thread's stdin
export async function injectThreadMessage(
	threadId: string,
	message: string,
): Promise<{ success: boolean; error?: string }> {
	const thread = threads.get(threadId);
	if (!thread?.proc) {
		return { success: false, error: "Thread not found or not running" };
	}

	try {
		const userMessage = {
			type: "user",
			session_id: threadId,
			message: {
				role: "user",
				content: message,
			},
			parent_tool_use_id: null,
		};

		thread.proc.stdin.write(`${JSON.stringify(userMessage)}\n`);
		return { success: true };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}

// Check if a thread exists (running or completed with buffer)
export function threadExists(threadId: string): boolean {
	return threads.has(threadId);
}

// Check if a thread is actively running
export function isThreadRunning(threadId: string): boolean {
	const thread = threads.get(threadId);
	return thread?.status === "running";
}

// Get thread status
export function getThreadStatus(
	threadId: string,
): ThreadState["status"] | null {
	return threads.get(threadId)?.status ?? null;
}

// Get buffered event count
export function getThreadBufferSize(threadId: string): number {
	return threads.get(threadId)?.eventBuffer.length ?? 0;
}

// Get all active thread IDs
export function getActiveThreadIds(): string[] {
	return Array.from(threads.entries())
		.filter(([_, t]) => t.status === "running")
		.map(([id]) => id);
}

// Clean up old completed threads (call periodically)
export function cleanupOldThreads(): void {
	for (const [id, thread] of threads) {
		if (thread.status !== "running" && !thread.proc) {
			threads.delete(id);
		}
	}
}
