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

// Clear session by deleting its transcript file directly
export async function clearSessionById(
	sessionId: string,
	projectPath?: string,
): Promise<void> {
	try {
		const targetCwd = projectPath ?? cwd;
		const projectFolder = targetCwd.replace(/\//g, "-");
		const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
		const transcriptPath = join(claudeDir, `${sessionId}.jsonl`);

		const transcriptFile = Bun.file(transcriptPath);
		if (await transcriptFile.exists()) {
			await transcriptFile.delete();
			console.debug(`Deleted transcript: ${transcriptPath}`);
		} else {
			console.debug(`Transcript not found: ${transcriptPath}`);
		}
	} catch (err) {
		console.error("Failed to clear session:", err);
		throw err;
	}
}
