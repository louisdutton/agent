import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTranscript } from "./transcript";

// Shared types for session history
export type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: "running" | "complete" | "error";
	resultImages?: string[];
};

export type Message =
	| { type: "user"; id: string; content: string }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] };

// Simplified state - only track cwd and per-session contexts
// Claude Code filesystem is the source of truth for session data
let cwd: string = process.cwd();

// Per-session state for concurrent session support
type SessionContext = {
	pid: number;
	startTime: number;
};

const activeSessions = new Map<string, SessionContext>();

export function getCwd(): string {
	return cwd;
}

export function setCwd(dir: string): void {
	cwd = dir;
}

// Get all active session IDs
export function getActiveSessions(): string[] {
	return Array.from(activeSessions.keys());
}

// Start tracking a session with its process PID
export function startSession(sessionId: string, pid: number): void {
	activeSessions.set(sessionId, {
		pid,
		startTime: Date.now(),
	});
}

// Stop tracking a session and kill its process
export function endSession(sessionId: string): boolean {
	const ctx = activeSessions.get(sessionId);
	if (ctx) {
		try {
			process.kill(ctx.pid);
		} catch {
			// Process may have already exited
		}
		activeSessions.delete(sessionId);
		return true;
	}
	return false;
}

// Check if a specific session has an active request
export function isSessionActive(sessionId: string): boolean {
	return activeSessions.has(sessionId);
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

// Scan project directory for session transcript files
export async function getSessionsFromTranscripts(
	projectPath?: string,
): Promise<SessionEntry[]> {
	const targetCwd = projectPath ?? getCwd();
	const projectFolder = targetCwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);

	try {
		const entries = await readdir(claudeDir, { withFileTypes: true });
		const jsonlFiles = entries
			.filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
			.map((e) => join(claudeDir, e.name));

		const sessions = await Promise.all(
			jsonlFiles.map((f) => extractSessionMetadata(f)),
		);

		return sessions.filter((s): s is SessionEntry => s !== null);
	} catch {
		// Directory doesn't exist or can't be read
		return [];
	}
}

// Get session history by specific session ID and project path
export async function getSessionHistoryById(
	sessionId: string,
	projectPath?: string,
): Promise<{
	messages: Message[];
	isCompacted: boolean;
	firstPrompt?: string;
}> {
	const targetCwd = projectPath ?? getCwd();
	const projectFolder = targetCwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);

	// Look for transcript file directly by sessionId
	const transcriptPath = join(claudeDir, `${sessionId}.jsonl`);

	try {
		const transcriptFile = Bun.file(transcriptPath);
		if (!(await transcriptFile.exists()))
			return { messages: [], isCompacted: false };

		const content = await transcriptFile.text();
		const { messages, isCompacted } = parseTranscript(content);

		// Extract firstPrompt from first user message
		let firstPrompt: string | undefined;
		for (const msg of messages) {
			if (msg.type === "user") {
				firstPrompt =
					msg.content.length > 100
						? `${msg.content.slice(0, 100)}...`
						: msg.content;
				break;
			}
		}

		return { messages, isCompacted, firstPrompt };
	} catch (err) {
		console.error("Error reading session history by ID:", err);
		return { messages: [], isCompacted: false };
	}
}

// Session entry type (derived from scanning transcript files)
type SessionEntry = {
	sessionId: string;
	firstPrompt?: string;
	created: string;
	modified: string;
	gitBranch?: string;
	isSidechain?: boolean;
	fullPath: string;
};

// Extract session metadata from a transcript file
// Returns null for empty sessions (no user messages)
async function extractSessionMetadata(
	filePath: string,
): Promise<SessionEntry | null> {
	try {
		const file = Bun.file(filePath);
		if (!(await file.exists())) return null;

		const stat = await file.stat();
		const text = await file.text();
		const lines = text.split("\n").filter(Boolean);

		let sessionId: string | null = null;
		let firstPrompt: string | undefined;
		let created: string | undefined;
		let gitBranch: string | undefined;
		let isSidechain = false;
		let hasUserMessage = false;

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);

				// Get sessionId from any entry
				if (!sessionId && entry.sessionId) {
					sessionId = entry.sessionId;
				}

				// Get created timestamp from first entry
				if (!created && entry.timestamp) {
					created = entry.timestamp;
				}

				// Get metadata from first user message
				if (entry.type === "user" && entry.message?.content) {
					hasUserMessage = true;
					if (entry.gitBranch) gitBranch = entry.gitBranch;
					if (entry.isSidechain) isSidechain = entry.isSidechain;

					// Extract first prompt text (skip tool results and meta messages)
					if (!firstPrompt && !entry.isMeta) {
						const content = entry.message.content;
						if (typeof content === "string" && !content.startsWith("<")) {
							firstPrompt = content;
						} else if (Array.isArray(content)) {
							const textBlock = content.find(
								(b: { type: string }) => b.type === "text",
							);
							if (textBlock?.text) {
								firstPrompt = textBlock.text;
							}
						}
					}

					// Once we have firstPrompt, we can stop scanning
					if (firstPrompt) break;
				}
			} catch {
				// Skip invalid JSON lines
			}
		}

		// Skip sessions with no user messages (empty or metadata-only files)
		if (!sessionId || !hasUserMessage) return null;

		return {
			sessionId,
			firstPrompt: firstPrompt
				? firstPrompt.length > 100
					? `${firstPrompt.slice(0, 100)}...`
					: firstPrompt
				: undefined,
			created: created || new Date(stat.mtime).toISOString(),
			modified: new Date(stat.mtime).toISOString(),
			gitBranch,
			isSidechain,
			fullPath: filePath,
		};
	} catch (err) {
		console.error(`Error reading transcript ${filePath}:`, err);
		return null;
	}
}
