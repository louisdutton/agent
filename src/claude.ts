import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

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

export async function* sendMessage(message: string): AsyncGenerator<string> {
	console.log(`Sending: ${message.slice(0, 50)}...`);

	// Determine which session this message belongs to
	const sessionId = activeSessionId;
	const cwd = getActiveSessionCwd();

	// Create abort controller for this specific request
	const abortController = new AbortController();

	// If we have a session, track the abort controller
	if (sessionId) {
		const session = getOrCreateSession(sessionId, cwd);
		session.abortController = abortController;
	}

	try {
		const options: Parameters<typeof query>[0]["options"] = {
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: "Your reponses must always be accurate and concise.",
			},
			// model: "claude-haiku-4-5",
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			includePartialMessages: true,
			abortController,
			cwd,
		};

		// If we have an active session, resume it; otherwise continue latest
		if (sessionId) {
			options.resume = sessionId;
		} else {
			options.continue = true;
		}

		for await (const event of query({
			prompt: message,
			options,
		})) {
			yield JSON.stringify(event);
		}
	} finally {
		// Clear abort controller for this session
		if (sessionId && sessions.has(sessionId)) {
			sessions.get(sessionId)!.abortController = null;
		}
	}
}

export function cancelCurrentRequest(): boolean {
	// Cancel the request for the currently active session
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
