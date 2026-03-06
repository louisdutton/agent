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

// Active worker processes (keyed by sessionId)
const workerProcesses = new Map<
	string,
	{
		proc: Subprocess<"pipe", "pipe", "pipe">;
		subscribers: Set<
			(event: SDKMessage | { type: "done" | "error"; error?: string }) => void
		>;
	}
>();

// Check if a directory has a flake.nix
async function hasFlake(dir: string): Promise<boolean> {
	const file = Bun.file(`${dir}/flake.nix`);
	return file.exists();
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
	// Check rate limit
	if (!canSpawnWorker()) {
		return { error: "Maximum number of workers reached" };
	}

	// Generate unique session ID
	const sessionId = `worker-${randomUUID().slice(0, 8)}`;

	// Register worker in store
	const session = registerWorker(sessionId, projectPath, parentSession, task);
	if (!session) {
		return { error: "Failed to register worker" };
	}

	try {
		// Determine whether to use nix develop
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

		// Close stdin since we pass the task as an argument
		proc.stdin.end();

		// Update session with PID
		markSessionRunning(sessionId, proc.pid);

		// Store process and create subscriber set
		workerProcesses.set(sessionId, {
			proc,
			subscribers: new Set(),
		});

		// Start reading output in background
		processWorkerOutput(sessionId);

		return { session };
	} catch (err) {
		markSessionError(sessionId);
		return { error: String(err) };
	}
}

// Process worker output and notify subscribers
async function processWorkerOutput(sessionId: string): Promise<void> {
	const worker = workerProcesses.get(sessionId);
	if (!worker) return;

	const { proc, subscribers } = worker;
	const decoder = new TextDecoder();
	const reader = proc.stdout.getReader();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Parse complete JSON lines
			const result = Bun.JSONL.parseChunk(buffer);
			for (const event of result.values as SDKMessage[]) {
				for (const callback of subscribers) {
					callback(event);
				}
			}

			// Keep unparsed remainder
			buffer = buffer.slice(result.read);
		}

		// Process remaining buffer
		if (buffer.trim()) {
			const result = Bun.JSONL.parseChunk(buffer);
			for (const event of result.values as SDKMessage[]) {
				for (const callback of subscribers) {
					callback(event);
				}
			}
		}

		// Wait for process to exit
		const exitCode = await proc.exited;

		if (exitCode === 0) {
			markSessionCompleted(sessionId);
		} else {
			const stderr = await new Response(proc.stderr).text();
			console.error(
				`Worker ${sessionId} exited with code ${exitCode}:`,
				stderr,
			);
			markSessionError(sessionId);
		}

		// Notify subscribers of completion
		for (const callback of subscribers) {
			callback({ type: "done" });
		}
	} catch (err) {
		console.error(`Worker ${sessionId} error:`, err);
		markSessionError(sessionId);

		// Notify subscribers of error
		for (const callback of subscribers) {
			callback({ type: "error", error: String(err) });
		}
	} finally {
		// Cleanup
		workerProcesses.delete(sessionId);
	}
}

// Subscribe to worker output events
export function subscribeToWorker(
	sessionId: string,
	callback: (
		event: SDKMessage | { type: "done" | "error"; error?: string },
	) => void,
): () => void {
	const worker = workerProcesses.get(sessionId);
	if (!worker) {
		// Worker not found or already finished
		callback({ type: "error", error: "Worker not found or already completed" });
		return () => {};
	}

	worker.subscribers.add(callback);

	// Return unsubscribe function
	return () => {
		worker.subscribers.delete(callback);
	};
}

// Stop a worker
export function stopWorker(sessionId: string): boolean {
	const worker = workerProcesses.get(sessionId);
	if (!worker) {
		return false;
	}

	try {
		worker.proc.kill("SIGTERM");
		markSessionStopped(sessionId);

		// Notify subscribers
		for (const callback of worker.subscribers) {
			callback({ type: "done" });
		}

		workerProcesses.delete(sessionId);
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
	const worker = workerProcesses.get(sessionId);
	if (!worker) {
		return { success: false, error: "Worker not found or not running" };
	}

	try {
		// Send user message via stdin (same format as claude.ts)
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

// Check if a worker is still running
export function isWorkerRunning(sessionId: string): boolean {
	return workerProcesses.has(sessionId);
}

// Get all active worker session IDs
export function getActiveWorkerIds(): string[] {
	return Array.from(workerProcesses.keys());
}

// Worker reports - messages that workers send back to the assistant
type WorkerReport = {
	id: string;
	workerId: string;
	timestamp: number;
	type: "progress" | "result" | "error" | "question";
	content: string;
	metadata?: Record<string, unknown>;
};

// In-memory report storage (keyed by worker sessionId)
const workerReports = new Map<string, WorkerReport[]>();

// Report from a worker to the assistant
export function reportToAssistant(
	workerId: string,
	type: WorkerReport["type"],
	content: string,
	metadata?: Record<string, unknown>,
): WorkerReport {
	const report: WorkerReport = {
		id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		workerId,
		timestamp: Date.now(),
		type,
		content,
		metadata,
	};

	const reports = workerReports.get(workerId) || [];
	reports.push(report);
	workerReports.set(workerId, reports);

	return report;
}

// Get all reports for a worker
export function getWorkerReports(workerId: string): WorkerReport[] {
	return workerReports.get(workerId) || [];
}

// Clear reports for a worker
export function clearWorkerReports(workerId: string): void {
	workerReports.delete(workerId);
}

// Get unread reports (reports since a given timestamp)
export function getWorkerReportsSince(
	workerId: string,
	sinceTimestamp: number,
): WorkerReport[] {
	const reports = workerReports.get(workerId) || [];
	return reports.filter((r) => r.timestamp > sinceTimestamp);
}
