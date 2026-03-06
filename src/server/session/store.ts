// Session store - replaces global cwd and manages all sessions

import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAssistantSession,
	createWorkerSession,
	type SessionContext,
	type SessionStatus,
	type SessionType,
} from "./context";

const STATE_FILE = join(homedir(), ".claude", "agent-state.json");
const MAX_THREADS = 5;
const WORKER_MAX_RUNTIME = 24 * 60 * 60 * 1000; // 24 hours

// In-memory session store
const sessions = new Map<string, SessionContext>();

// Assistant singleton
let assistantSession: SessionContext | null = null;

// Get the assistant session (creates if needed)
export function getAssistant(): SessionContext {
	if (!assistantSession) {
		assistantSession = createAssistantSession("assistant");
	}
	return assistantSession;
}

// Get a session by ID
export function getSession(sessionId: string): SessionContext | undefined {
	if (sessionId === "assistant") return getAssistant();
	return sessions.get(sessionId);
}

// Get all sessions, optionally filtered by type
export function getAllSessions(type?: SessionType): SessionContext[] {
	const all = Array.from(sessions.values());
	if (!type) return all;
	return all.filter((s) => s.type === type);
}

// Get all active threads (running or idle)
export function getActiveThreads(): SessionContext[] {
	return getAllSessions("worker").filter(
		(s) => s.status === "running" || s.status === "idle",
	);
}

// Get all threads (any status)
export function getAllThreads(): SessionContext[] {
	return getAllSessions("worker");
}

// Check if we can spawn more threads
export function canSpawnThread(): boolean {
	return getActiveThreads().length < MAX_THREADS;
}

// Legacy aliases for compatibility
export const getActiveWorkers = getActiveThreads;
export const getAllWorkers = getAllThreads;
export const canSpawnWorker = canSpawnThread;
export const startWorker = startThread;
export const cleanupStaleWorkers = cleanupStaleThreads;

// Register a new session
export function registerSession(ctx: SessionContext): void {
	sessions.set(ctx.sessionId, ctx);
	saveState();
}

// Update session status
export function updateSessionStatus(
	sessionId: string,
	status: SessionStatus,
	pid?: number,
): void {
	const session = getSession(sessionId);
	if (session) {
		session.status = status;
		if (pid !== undefined) session.pid = pid;
		saveState();
	}
}

// Remove a session
export function removeSession(sessionId: string): boolean {
	const removed = sessions.delete(sessionId);
	if (removed) saveState();
	return removed;
}

// Start a new thread
export function startThread(
	sessionId: string,
	projectPath: string,
	parentSession: string,
	task: string,
): SessionContext | null {
	if (!canSpawnWorker()) return null;

	const ctx = createWorkerSession(sessionId, projectPath, parentSession, task);
	ctx.status = "running";
	registerSession(ctx);
	return ctx;
}

// Mark a session as started with a PID
export function markSessionRunning(sessionId: string, pid: number): void {
	updateSessionStatus(sessionId, "running", pid);
}

// Mark a session as stopped
export function markSessionStopped(sessionId: string): void {
	const session = getSession(sessionId);
	if (session) {
		session.status = "stopped";
		session.pid = null;
		saveState();
	}
}

// Mark a session as completed
export function markSessionCompleted(sessionId: string): void {
	updateSessionStatus(sessionId, "completed");
}

// Mark a session as error
export function markSessionError(sessionId: string): void {
	updateSessionStatus(sessionId, "error");
}

// Check for stale/timed out threads
export function cleanupStaleThreads(): void {
	const now = Date.now();
	for (const session of getAllSessions("worker")) {
		const age = now - session.startTime;

		// Check max runtime
		if (age > WORKER_MAX_RUNTIME) {
			markSessionError(session.sessionId);
			continue;
		}

		// Check if process is still alive
		if (session.pid && session.status === "running") {
			try {
				process.kill(session.pid, 0); // Check if process exists
			} catch {
				// Process no longer exists
				markSessionError(session.sessionId);
			}
		}
	}
}

// Persist state to disk
async function saveState(): Promise<void> {
	const state = {
		sessions: Array.from(sessions.entries()),
		assistantSession,
		savedAt: new Date().toISOString(),
	};
	try {
		await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
	} catch (err) {
		console.error("Failed to save session state:", err);
	}
}

// Load state from disk
export async function loadState(): Promise<void> {
	try {
		const file = Bun.file(STATE_FILE);
		if (await file.exists()) {
			const data = await file.json();

			// Restore sessions
			if (data.sessions) {
				for (const [id, ctx] of data.sessions) {
					sessions.set(id, ctx);
				}
			}

			// Restore assistant
			if (data.assistantSession) {
				assistantSession = data.assistantSession;
			}

			// Clean up stale threads
			cleanupStaleThreads();
		}
	} catch (err) {
		console.error("Failed to load session state:", err);
	}
}
