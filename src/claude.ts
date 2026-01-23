import { homedir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

// Track the current abort controller for cancellation
let currentAbortController: AbortController | null = null;

// Track the active session ID for resuming
let activeSessionId: string | null = null;

export function setActiveSession(sessionId: string | null): void {
	activeSessionId = sessionId;
}

export function getActiveSession(): string | null {
	return activeSessionId;
}

export async function* sendMessage(message: string): AsyncGenerator<string> {
	console.log(`Sending: ${message.slice(0, 50)}...`);

	// Create a new abort controller for this request
	currentAbortController = new AbortController();

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
			abortController: currentAbortController,
		};

		// If we have an active session, resume it; otherwise continue latest
		if (activeSessionId) {
			options.resume = activeSessionId;
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
		currentAbortController = null;
	}
}

export function cancelCurrentRequest(): boolean {
	if (currentAbortController) {
		currentAbortController.abort();
		currentAbortController = null;
		console.log("Request cancelled");
		return true;
	}
	return false;
}

export async function clearSession(): Promise<void> {
	try {
		const cwd = process.cwd();
		const projectFolder = cwd.replace(/\//g, "-");
		const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
		const indexPath = join(claudeDir, "sessions-index.json");

		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) {
			console.log("No session index found");
			return;
		}

		const index = await indexFile.json();
		const sessions = index.entries
			.filter((e: { isSidechain: boolean }) => !e.isSidechain)
			.sort(
				(a: { modified: string }, b: { modified: string }) =>
					new Date(b.modified).getTime() - new Date(a.modified).getTime(),
			);

		if (sessions.length === 0) {
			console.log("No sessions to clear");
			return;
		}

		const latestSession = sessions[0];
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
