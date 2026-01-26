import { homedir } from "node:os";
import { join } from "node:path";

// Session state - each session has its own context
type SessionState = {
	sessionId: string;
	cwd: string;
	abortController: AbortController | null;
};

// Track the current session only (no need for a Map since we only have one active at a time)
let currentSession: SessionState | null = null;

// The currently active session ID
let activeSessionId: string | null = null;

// Default cwd for new sessions (can be changed when starting a new session)
let pendingCwd: string = process.cwd();

export function getOrCreateSession(
	sessionId: string,
	cwd?: string,
): SessionState {
	// If switching to a different session, clear the old one
	if (currentSession && currentSession.sessionId !== sessionId) {
		currentSession = null;
	}

	if (!currentSession || currentSession.sessionId !== sessionId) {
		currentSession = {
			sessionId,
			cwd: cwd ?? pendingCwd,
			abortController: null,
		};
	}
	return currentSession;
}

export function getSession(sessionId: string): SessionState | undefined {
	if (currentSession?.sessionId === sessionId) {
		return currentSession;
	}
	return undefined;
}

export function setActiveSession(sessionId: string | null, cwd?: string): void {
	activeSessionId = sessionId;
	if (sessionId && cwd) {
		getOrCreateSession(sessionId, cwd);
	} else if (sessionId && currentSession?.sessionId !== sessionId) {
		// Switching to a session without cwd - create with pending
		getOrCreateSession(sessionId, pendingCwd);
	} else if (!sessionId) {
		// Clearing session
		currentSession = null;
		if (cwd) {
			pendingCwd = cwd;
		}
	}
}

export function getActiveSession(): string | null {
	return activeSessionId;
}

export function getActiveSessionCwd(): string {
	if (activeSessionId && currentSession?.sessionId === activeSessionId) {
		return currentSession.cwd;
	}
	return pendingCwd;
}

export function setPendingCwd(cwd: string): void {
	pendingCwd = cwd;
}

export function setAbortController(
	sessionId: string,
	controller: AbortController | null,
): void {
	if (currentSession?.sessionId === sessionId) {
		currentSession.abortController = controller;
	}
}

export function cancelCurrentRequest(): boolean {
	if (activeSessionId && currentSession?.sessionId === activeSessionId) {
		if (currentSession.abortController) {
			currentSession.abortController.abort();
			currentSession.abortController = null;
			console.log("Request cancelled");
			return true;
		}
	}
	return false;
}

export function isRequestInProgress(sessionId?: string): boolean {
	const targetSessionId = sessionId ?? activeSessionId;
	return !!(
		targetSessionId &&
		currentSession?.sessionId === targetSessionId &&
		currentSession.abortController
	);
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

		// Clear the active session if it was the one we deleted
		if (activeSessionId === latestSession.sessionId) {
			activeSessionId = null;
			currentSession = null;
		}
	} catch (err) {
		console.error("Failed to clear session:", err);
		throw err;
	}
}
