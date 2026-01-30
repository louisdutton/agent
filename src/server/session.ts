import { homedir } from "node:os";
import { join } from "node:path";

// Simplified state - only track cwd and abort controller
// Claude Code filesystem is the source of truth for session data
let cwd: string = process.cwd();
let abortController: AbortController | null = null;

export function getCwd(): string {
	return cwd;
}

export function setCwd(dir: string): void {
	cwd = dir;
}

export function setAbortController(controller: AbortController | null): void {
	abortController = controller;
}

export function getAbortController(): AbortController | null {
	return abortController;
}

export function cancelCurrentRequest(): boolean {
	if (abortController) {
		abortController.abort();
		abortController = null;
		console.debug("Request cancelled");
		return true;
	}
	return false;
}

export function isRequestInProgress(): boolean {
	return abortController !== null;
}

// Clear session by deleting its transcript file and removing from index
export async function clearSessionById(
	sessionId: string,
	projectPath?: string,
): Promise<void> {
	try {
		const targetCwd = projectPath ?? cwd;
		const projectFolder = targetCwd.replace(/\//g, "-");
		const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
		const indexPath = join(claudeDir, "sessions-index.json");

		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) {
			console.debug("No session index found");
			return;
		}

		const index = await indexFile.json();
		const session = index.entries.find(
			(e: { sessionId: string }) => e.sessionId === sessionId,
		);

		if (!session) {
			console.debug("Session not found in index");
			return;
		}

		// Delete the transcript file
		const transcriptFile = Bun.file(session.fullPath);
		if (await transcriptFile.exists()) {
			await Bun.file(session.fullPath).delete();
			console.debug(`Deleted transcript: ${session.fullPath}`);
		}

		// Remove the session from the index
		const updatedIndex = {
			...index,
			entries: index.entries.filter(
				(e: { sessionId: string }) => e.sessionId !== sessionId,
			),
		};

		await Bun.write(indexPath, JSON.stringify(updatedIndex, null, 2));
		console.debug("Session removed from index");
	} catch (err) {
		console.error("Failed to clear session:", err);
		throw err;
	}
}
