// Worker session management - spawning, stopping, and streaming output

import { randomUUID } from "node:crypto";
import { type Subprocess, spawn } from "bun";
import type { SDKMessage } from "../claude/claude-cli-types";
import type { SessionContext } from "./context";
import {
	canSpawnWorker,
	markSessionCompleted,
	markSessionError,
	markSessionRunning,
	markSessionStopped,
	startWorker as registerWorker,
} from "./store";

// Event types for worker streams
export type WorkerEvent =
	| SDKMessage
	| { type: "done" }
	| { type: "error"; error: string };

// Worker state with event buffer for replay
type WorkerState = {
	proc: Subprocess<"pipe", "pipe", "pipe"> | null;
	subscribers: Set<(event: WorkerEvent) => void>;
	eventBuffer: WorkerEvent[];
	status: "running" | "completed" | "error" | "stopped";
	maxBufferSize: number;
};

// Active workers (keyed by sessionId)
const workers = new Map<string, WorkerState>();

// Check if a directory has a flake.nix
async function hasFlake(dir: string): Promise<boolean> {
	const file = Bun.file(`${dir}/flake.nix`);
	return file.exists();
}

// Emit event to all subscribers and buffer it
function emitEvent(sessionId: string, event: WorkerEvent): void {
	const worker = workers.get(sessionId);
	if (!worker) return;

	// Add to buffer (with size limit)
	if (worker.eventBuffer.length >= worker.maxBufferSize) {
		worker.eventBuffer.shift();
	}
	worker.eventBuffer.push(event);

	// Notify all subscribers
	for (const callback of worker.subscribers) {
		try {
			callback(event);
		} catch (err) {
			console.error("Subscriber callback error:", err);
		}
	}
}

// Spawn a new worker session
export async function spawnWorker(
	projectPath: string,
	task: string,
	parentSession: string,
): Promise<
	| { session: SessionContext; error?: undefined }
	| { session?: undefined; error: string }
> {
	if (!canSpawnWorker()) {
		return { error: "Maximum number of workers reached" };
	}

	const sessionId = `worker-${randomUUID().slice(0, 8)}`;
	const session = registerWorker(sessionId, projectPath, parentSession, task);
	if (!session) {
		return { error: "Failed to register worker" };
	}

	// Initialize worker state with buffer
	const workerState: WorkerState = {
		proc: null,
		subscribers: new Set(),
		eventBuffer: [],
		status: "running",
		maxBufferSize: 1000,
	};
	workers.set(sessionId, workerState);

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
		workerState.proc = proc;
		markSessionRunning(sessionId, proc.pid);

		// Start processing output
		processWorkerOutput(sessionId);

		return { session };
	} catch (err) {
		workerState.status = "error";
		markSessionError(sessionId);
		emitEvent(sessionId, { type: "error", error: String(err) });
		return { error: String(err) };
	}
}

// Process worker output and emit events
async function processWorkerOutput(sessionId: string): Promise<void> {
	const worker = workers.get(sessionId);
	if (!worker?.proc) return;

	const { proc } = worker;
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
				emitEvent(sessionId, event);
			}
			buffer = buffer.slice(result.read);
		}

		// Process remaining buffer
		if (buffer.trim()) {
			const result = Bun.JSONL.parseChunk(buffer);
			for (const event of result.values as SDKMessage[]) {
				emitEvent(sessionId, event);
			}
		}

		const exitCode = await proc.exited;

		if (exitCode === 0) {
			worker.status = "completed";
			markSessionCompleted(sessionId);
		} else {
			const stderr = await new Response(proc.stderr).text();
			console.error(
				`Worker ${sessionId} exited with code ${exitCode}:`,
				stderr,
			);
			worker.status = "error";
			markSessionError(sessionId);
		}

		emitEvent(sessionId, { type: "done" });
	} catch (err) {
		console.error(`Worker ${sessionId} error:`, err);
		worker.status = "error";
		markSessionError(sessionId);
		emitEvent(sessionId, { type: "error", error: String(err) });
	} finally {
		worker.proc = null;
	}
}

// Subscribe to worker events with replay support
export function subscribeToWorker(
	sessionId: string,
	callback: (event: WorkerEvent) => void,
	options: { replay?: boolean } = {},
): () => void {
	const worker = workers.get(sessionId);

	if (!worker) {
		// Worker doesn't exist at all
		callback({ type: "error", error: "Worker not found" });
		return () => {};
	}

	// Replay buffered events if requested (default: true)
	const shouldReplay = options.replay !== false;
	if (shouldReplay && worker.eventBuffer.length > 0) {
		for (const event of worker.eventBuffer) {
			try {
				callback(event);
			} catch (err) {
				console.error("Replay callback error:", err);
			}
		}
	}

	// If already done, don't add to subscribers
	if (worker.status !== "running") {
		// Send final status if not already in buffer
		const lastEvent = worker.eventBuffer[worker.eventBuffer.length - 1];
		if (
			!lastEvent ||
			(lastEvent.type !== "done" && lastEvent.type !== "error")
		) {
			callback({ type: "done" });
		}
		return () => {};
	}

	// Add to live subscribers
	worker.subscribers.add(callback);

	return () => {
		worker.subscribers.delete(callback);
	};
}

// Stop a worker
export function stopWorker(sessionId: string): boolean {
	const worker = workers.get(sessionId);
	if (!worker) return false;

	try {
		if (worker.proc) {
			worker.proc.kill("SIGTERM");
		}
		worker.status = "stopped";
		markSessionStopped(sessionId);
		emitEvent(sessionId, { type: "done" });
		return true;
	} catch (err) {
		console.error(`Failed to stop worker ${sessionId}:`, err);
		return false;
	}
}

// Inject a message into a running worker's stdin
export async function injectMessage(
	sessionId: string,
	message: string,
): Promise<{ success: boolean; error?: string }> {
	const worker = workers.get(sessionId);
	if (!worker?.proc) {
		return { success: false, error: "Worker not found or not running" };
	}

	try {
		const userMessage = {
			type: "user",
			session_id: sessionId,
			message: {
				role: "user",
				content: message,
			},
			parent_tool_use_id: null,
		};

		worker.proc.stdin.write(`${JSON.stringify(userMessage)}\n`);
		return { success: true };
	} catch (err) {
		return { success: false, error: String(err) };
	}
}

// Check if a worker exists (running or completed with buffer)
export function workerExists(sessionId: string): boolean {
	return workers.has(sessionId);
}

// Check if a worker is actively running
export function isWorkerRunning(sessionId: string): boolean {
	const worker = workers.get(sessionId);
	return worker?.status === "running";
}

// Get worker status
export function getWorkerStatus(
	sessionId: string,
): WorkerState["status"] | null {
	return workers.get(sessionId)?.status ?? null;
}

// Get buffered event count
export function getWorkerBufferSize(sessionId: string): number {
	return workers.get(sessionId)?.eventBuffer.length ?? 0;
}

// Get all active worker session IDs
export function getActiveWorkerIds(): string[] {
	return Array.from(workers.entries())
		.filter(([_, w]) => w.status === "running")
		.map(([id]) => id);
}

// Clean up old completed workers (call periodically)
export function cleanupOldWorkers(): void {
	for (const [id, worker] of workers) {
		if (worker.status !== "running" && !worker.proc) {
			workers.delete(id);
		}
	}
}
