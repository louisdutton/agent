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

// Session event for streaming
export type SessionEvent = { type: string; [key: string]: unknown };

// Per-session state for concurrent session support
type ActiveSession = {
	pid: number;
	startTime: number;
	subscribers: Set<(event: SessionEvent) => void>;
	eventBuffer: SessionEvent[];
};

const activeSessions = new Map<string, ActiveSession>();
const MAX_BUFFER_SIZE = 500;

// Get all active session IDs
export function getActiveSessionIds(): string[] {
	return Array.from(activeSessions.keys());
}

// Start tracking a session with its process PID
export function startSession(sessionId: string, pid: number): void {
	activeSessions.set(sessionId, {
		pid,
		startTime: Date.now(),
		subscribers: new Set(),
		eventBuffer: [],
	});
}

// Emit an event to session subscribers and buffer it
export function emitSessionEvent(sessionId: string, event: SessionEvent): void {
	const session = activeSessions.get(sessionId);
	if (!session) return;

	// Buffer event
	if (session.eventBuffer.length >= MAX_BUFFER_SIZE) {
		session.eventBuffer.shift();
	}
	session.eventBuffer.push(event);

	// Notify subscribers
	for (const callback of session.subscribers) {
		try {
			callback(event);
		} catch (err) {
			console.error("Session subscriber error:", err);
		}
	}
}

// Check if event is terminal
function isTerminalEvent(event: SessionEvent): boolean {
	return (
		event.type === "done" ||
		event.type === "error" ||
		event.type === "cancelled"
	);
}

// Subscribe to session events with optional replay
export function subscribeToSession(
	sessionId: string,
	callback: (event: SessionEvent) => void,
	options: { replay?: boolean } = {},
): () => void {
	const session = activeSessions.get(sessionId);
	if (!session) {
		callback({ type: "error", error: "Session not active" });
		return () => {};
	}

	// Replay buffered events if requested
	if (options.replay !== false) {
		for (const event of session.eventBuffer) {
			try {
				callback(event);
			} catch (err) {
				console.error("Replay callback error:", err);
			}
		}

		// If buffer already contains terminal event, don't add subscriber
		const lastEvent = session.eventBuffer[session.eventBuffer.length - 1];
		if (lastEvent && isTerminalEvent(lastEvent)) {
			return () => {};
		}
	}

	session.subscribers.add(callback);
	return () => {
		session.subscribers.delete(callback);
	};
}

// Stop tracking a session (does not kill the process - use cancelSession for that)
export function endSession(sessionId: string): boolean {
	const session = activeSessions.get(sessionId);
	if (session) {
		// Emit done event to buffer and notify subscribers
		emitSessionEvent(sessionId, { type: "done" });
		activeSessions.delete(sessionId);
		return true;
	}
	return false;
}

// Cancel a session by killing its process
export function cancelSession(sessionId: string): boolean {
	const session = activeSessions.get(sessionId);
	if (session) {
		try {
			process.kill(session.pid);
		} catch {
			// Process may have already exited
		}
		// Emit cancelled event to buffer and notify subscribers
		emitSessionEvent(sessionId, { type: "cancelled" });
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
// projectPath is required - no fallback to global cwd
export async function clearSessionById(
	sessionId: string,
	projectPath: string,
): Promise<void> {
	try {
		const projectFolder = projectPath.replace(/[/.]/g, "-");
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
// projectPath is required - no fallback to global cwd
export async function getSessionsFromTranscripts(
	projectPath: string,
): Promise<SessionEntry[]> {
	const projectFolder = projectPath.replace(/[/.]/g, "-");
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
// projectPath is required - no fallback to global cwd
export async function getSessionHistoryById(
	sessionId: string,
	projectPath: string,
): Promise<{
	messages: Message[];
	isCompacted: boolean;
	firstPrompt?: string;
}> {
	const projectFolder = projectPath.replace(/[/.]/g, "-");
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
