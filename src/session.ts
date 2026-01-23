import { homedir } from "node:os";
import { join } from "node:path";

// Session state - each session has its own context
type SessionState = {
	sessionId: string;
	cwd: string;
	abortController: AbortController | null;
};

// Track all active sessions by ID
const sessions = new Map<string, SessionState>();

// The currently active session
let activeSessionId: string | null = null;

// Default cwd for new sessions (can be changed when starting a new session)
let pendingCwd: string = process.cwd();

export function getOrCreateSession(sessionId: string, cwd?: string): SessionState {
	if (!sessions.has(sessionId)) {
		sessions.set(sessionId, {
			sessionId,
			cwd: cwd ?? pendingCwd,
			abortController: null,
		});
	}
	return sessions.get(sessionId)!;
}

export function getSession(sessionId: string): SessionState | undefined {
	return sessions.get(sessionId);
}

export function setActiveSession(sessionId: string | null, cwd?: string): void {
	activeSessionId = sessionId;
	if (sessionId && cwd) {
		getOrCreateSession(sessionId, cwd);
	}
	// If clearing session (null) with a cwd, set it as pending for next session
	if (!sessionId && cwd) {
		pendingCwd = cwd;
	}
}

export function getActiveSession(): string | null {
	return activeSessionId;
}

export function getActiveSessionCwd(): string {
	if (activeSessionId && sessions.has(activeSessionId)) {
		return sessions.get(activeSessionId)!.cwd;
	}
	return pendingCwd;
}

export function setPendingCwd(cwd: string): void {
	pendingCwd = cwd;
}

export function setAbortController(sessionId: string, controller: AbortController | null): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.abortController = controller;
	}
}

export function cancelCurrentRequest(): boolean {
	if (activeSessionId && sessions.has(activeSessionId)) {
		const session = sessions.get(activeSessionId)!;
		if (session.abortController) {
			session.abortController.abort();
			session.abortController = null;
			console.log("Request cancelled");
			return true;
		}
	}
	return false;
}

export async function clearSession(): Promise<void> {
	try {
		const cwd = getActiveSessionCwd();
		const projectFolder = cwd.replace(/\//g, "-");
		const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
		const indexPath = join(claudeDir, "sessions-index.json");

		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) {
			console.log("No session index found");
			return;
		}

		const index = await indexFile.json();
		const sessionList = index.entries
			.filter((e: { isSidechain: boolean }) => !e.isSidechain)
			.sort(
				(a: { modified: string }, b: { modified: string }) =>
					new Date(b.modified).getTime() - new Date(a.modified).getTime(),
			);

		if (sessionList.length === 0) {
			console.log("No sessions to clear");
			return;
		}

		const latestSession = sessionList[0];
		const transcriptPath = latestSession.fullPath;

		// Delete the transcript file
		const transcriptFile = Bun.file(transcriptPath);
		if (await transcriptFile.exists()) {
			await Bun.file(transcriptPath).delete();
			console.log(`Deleted transcript: ${transcriptPath}`);
		}

		// Remove the session from the index
		const updatedIndex = {
			...index,
			entries: index.entries.filter(
				(e: { fullPath: string }) => e.fullPath !== transcriptPath,
			),
		};

		await Bun.write(indexPath, JSON.stringify(updatedIndex, null, 2));
		console.log("Session removed from index");
	} catch (err) {
		console.error("Failed to clear session:", err);
		throw err;
	}
}
