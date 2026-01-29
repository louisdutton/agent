import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { clearContext, compactSession, sendMessage } from "./claude";
import {
	cancelCurrentRequest,
	clearSession,
	getActiveSession,
	getActiveSessionCwd,
	isRequestInProgress,
	setActiveSession,
} from "./session";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9371";
const KOKORO_URL = process.env.KOKORO_URL || "http://localhost:9372";

// Helper to create JSON response with CORS headers
const json = (data: unknown, init?: ResponseInit) =>
	Response.json(data, {
		...init,
		headers: { ...corsHeaders, ...init?.headers },
	});

const error = (message: string, status = 500) =>
	json({ error: message }, { status });

// Git diff types
type DiffLineType = "context" | "addition" | "deletion";
type DiffLine = {
	type: DiffLineType;
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
};
type DiffHunk = { header: string; lines: DiffLine[] };
type DiffFile = {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed";
	hunks: DiffHunk[];
};

// Parse git diff output into structured format
function parseDiff(rawDiff: string): DiffFile[] {
	const files: DiffFile[] = [];
	const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

	for (const chunk of fileChunks) {
		const lines = chunk.split("\n");
		const pathMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
		if (!pathMatch) continue;

		const file: DiffFile = {
			path: pathMatch[2],
			status: "modified",
			hunks: [],
		};

		// Detect status from header
		if (lines.some((l) => l.startsWith("new file"))) file.status = "added";
		if (lines.some((l) => l.startsWith("deleted file")))
			file.status = "deleted";
		if (lines.some((l) => l.startsWith("rename"))) file.status = "renamed";

		// Parse hunks
		let currentHunk: DiffHunk | null = null;
		let oldLineNum = 0;
		let newLineNum = 0;

		for (const line of lines) {
			if (line.startsWith("@@")) {
				const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
				if (match) {
					oldLineNum = Number.parseInt(match[1]);
					newLineNum = Number.parseInt(match[2]);
					currentHunk = { header: line, lines: [] };
					file.hunks.push(currentHunk);
				}
			} else if (
				currentHunk &&
				(line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
			) {
				const type: DiffLineType =
					line[0] === "+"
						? "addition"
						: line[0] === "-"
							? "deletion"
							: "context";
				currentHunk.lines.push({
					type,
					content: line.slice(1),
					oldLineNum: type !== "addition" ? oldLineNum++ : undefined,
					newLineNum: type !== "deletion" ? newLineNum++ : undefined,
				});
			}
		}

		files.push(file);
	}

	return files;
}

// Shared types for session history
type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: "running" | "complete" | "error";
};
type Message =
	| { type: "user"; id: string; content: string }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] };

// Parse transcript content into messages
function parseTranscript(content: string): {
	messages: Message[];
	isCompacted: boolean;
} {
	const lines = content.trim().split("\n").filter(Boolean);
	const messages: Message[] = [];
	const toolResults = new Map<string, boolean>();
	let isCompacted = false;
	let compactBoundaryIndex = -1;

	// First pass: find compact boundary and collect all tool results
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		try {
			const entry = JSON.parse(line);
			// Check for compact boundary marker
			if (entry.type === "system" && entry.subtype === "compact_boundary") {
				isCompacted = true;
				compactBoundaryIndex = i;
			}
			if (entry.type === "user" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (Array.isArray(entryContent)) {
					for (const block of entryContent) {
						if (block.type === "tool_result" && block.tool_use_id) {
							toolResults.set(block.tool_use_id, !!block.is_error);
						}
					}
				}
			}
		} catch {
			// Skip invalid JSON
		}
	}

	// If compacted, only process lines after the compact boundary
	// Skip the boundary itself and the summary message that follows
	const startIndex = isCompacted ? compactBoundaryIndex + 2 : 0;

	// Second pass: build messages (starting after compact boundary if present)
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];
		try {
			const entry = JSON.parse(line);
			if (entry.type === "user" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (typeof entryContent === "string") {
					if (!entry.isMeta && !entryContent.startsWith("<")) {
						messages.push({
							type: "user",
							id: entry.uuid,
							content: entryContent,
						});
					}
				} else if (Array.isArray(entryContent)) {
					const textBlocks = entryContent.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "user", id: entry.uuid, content: text });
					}
				}
			} else if (entry.type === "assistant" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (!Array.isArray(entryContent)) continue;

				const textBlocks = entryContent.filter(
					(b: { type: string }) => b.type === "text",
				);
				const text = textBlocks.map((b: { text: string }) => b.text).join("");
				if (text) {
					messages.push({ type: "assistant", id: entry.uuid, content: text });
				}

				const toolUses = entryContent.filter(
					(b: { type: string }) => b.type === "tool_use",
				);
				if (toolUses.length > 0) {
					const tools: Tool[] = toolUses.map(
						(t: {
							id: string;
							name: string;
							input: Record<string, unknown>;
						}) => ({
							toolUseId: t.id,
							name: t.name,
							input: t.input || {},
							status: toolResults.has(t.id)
								? toolResults.get(t.id)
									? "error"
									: "complete"
								: "complete",
						}),
					);
					messages.push({
						type: "tools",
						id: `tools-${entry.uuid}`,
						tools,
					});
				}
			}
		} catch {
			// Skip invalid JSON lines
		}
	}

	// Merge consecutive tool groups
	const mergedMessages: Message[] = [];
	for (const msg of messages) {
		const last = mergedMessages[mergedMessages.length - 1];
		if (msg.type === "tools" && last && last.type === "tools") {
			mergedMessages[mergedMessages.length - 1] = {
				...last,
				tools: [...last.tools, ...msg.tools],
			};
		} else {
			mergedMessages.push(msg);
		}
	}

	return { messages: mergedMessages, isCompacted };
}

// Get session history by specific session ID and project path
async function getSessionHistoryById(
	sessionId: string,
	projectPath?: string,
): Promise<{
	messages: Message[];
	isCompacted: boolean;
	firstPrompt?: string;
}> {
	const cwd = projectPath ?? getActiveSessionCwd();
	const projectFolder = cwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
	const indexPath = join(claudeDir, "sessions-index.json");

	try {
		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists()))
			return { messages: [], isCompacted: false };

		const index = await indexFile.json();
		const session = index.entries.find(
			(e: { sessionId: string }) => e.sessionId === sessionId,
		);

		if (!session) return { messages: [], isCompacted: false };

		const transcriptFile = Bun.file(session.fullPath);
		if (!(await transcriptFile.exists()))
			return { messages: [], isCompacted: false };

		const content = await transcriptFile.text();
		const { messages, isCompacted } = parseTranscript(content);
		return { messages, isCompacted, firstPrompt: session.firstPrompt };
	} catch (err) {
		console.error("Error reading session history by ID:", err);
		return { messages: [], isCompacted: false };
	}
}

// Session index types
type SessionIndexEntry = {
	sessionId: string;
	firstPrompt?: string;
	messageCount?: number;
	created?: string;
	modified: string;
	gitBranch?: string;
	isSidechain?: boolean;
	fullPath: string;
};

type SessionIndex = {
	entries: SessionIndexEntry[];
};

// Helper to get session index
async function getSessionIndex(): Promise<SessionIndex | null> {
	const cwd = getActiveSessionCwd();
	const projectFolder = cwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
	const indexPath = join(claudeDir, "sessions-index.json");

	const indexFile = Bun.file(indexPath);
	if (!(await indexFile.exists())) return null;
	return indexFile.json();
}

// Declarative API routes
export const routes = {
	// Send message (streaming)
	"/api/messages": {
		POST: async (req: Request) => {
			const body = (await req.json()) as { message: string };
			console.debug(`POST /api/messages:`, body.message?.slice(0, 50));

			try {
				const encoder = new TextEncoder();
				let controllerClosed = false;
				const stream = new ReadableStream({
					async start(controller) {
						try {
							for await (const line of sendMessage(body.message)) {
								if (controllerClosed) break;
								controller.enqueue(encoder.encode(`data: ${line}\n\n`));
							}
							if (!controllerClosed) {
								controller.enqueue(encoder.encode("data: [DONE]\n\n"));
							}
						} catch (err) {
							console.error("Stream error:", err);
							if (!controllerClosed) {
								try {
									controller.enqueue(
										encoder.encode(`data: {"error": "${String(err)}"}\n\n`),
									);
								} catch {
									// Controller already closed
								}
							}
						} finally {
							if (!controllerClosed) {
								controllerClosed = true;
								controller.close();
							}
						}
					},
					cancel() {
						controllerClosed = true;
					},
				});

				return new Response(stream, {
					headers: {
						...corsHeaders,
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
					},
				});
			} catch (err) {
				console.error("Error running claude:", err);
				return error(String(err));
			}
		},
	},

	// Get cwd and optionally the latest session
	"/api/cwd": {
		GET: async () => {
			const cwd = getActiveSessionCwd();
			try {
				const index = await getSessionIndex();
				if (index) {
					const sessions = index.entries
						.filter((e) => !e.isSidechain)
						.sort(
							(a, b) =>
								new Date(b.modified).getTime() - new Date(a.modified).getTime(),
						);

					if (sessions.length > 0) {
						return json({ cwd, latestSessionId: sessions[0].sessionId });
					}
				}
			} catch {
				// Ignore errors, just return cwd
			}
			return json({ cwd });
		},
	},

	// Cancel current request
	"/api/cancel": {
		POST: () => {
			const cancelled = cancelCurrentRequest();
			return json({ cancelled });
		},
	},

	// Clear session (legacy endpoints)
	"/api/session": {
		DELETE: async () => {
			try {
				await clearSession();
				return json({ ok: true });
			} catch (err) {
				console.error("Failed to clear session:", err);
				return error(String(err));
			}
		},
	},

	"/api/clear": {
		POST: async () => {
			try {
				await clearSession();
				return json({ ok: true });
			} catch (err) {
				console.error("Failed to clear session:", err);
				return error(String(err));
			}
		},
	},

	// Session history by ID
	"/api/session/:sessionId/history": {
		GET: async (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const cwd = getActiveSessionCwd();
			const { messages, isCompacted, firstPrompt } =
				await getSessionHistoryById(sessionId);
			setActiveSession(sessionId);
			return json({ messages, cwd, sessionId, isCompacted, firstPrompt });
		},
	},

	// Session status (busy check)
	"/api/session/:sessionId/status": {
		GET: (req: Request & { params: { sessionId: string } }) => {
			const busy = isRequestInProgress(req.params.sessionId);
			return json({ busy });
		},
	},

	// Compact session context
	"/api/session/:sessionId/compact": {
		POST: async (req: Request & { params: { sessionId: string } }) => {
			setActiveSession(req.params.sessionId);
			const result = await compactSession();
			if (result.success) {
				return json({ ok: true });
			}
			return error(result.error || "Compaction failed");
		},
	},

	// Clear session context
	"/api/session/:sessionId/clear": {
		POST: async (req: Request & { params: { sessionId: string } }) => {
			setActiveSession(req.params.sessionId);
			const result = await clearContext();
			if (result.success) {
				return json({ ok: true });
			}
			return error(result.error || "Clear failed");
		},
	},

	// List all sessions
	"/api/sessions": {
		GET: async () => {
			try {
				const index = await getSessionIndex();
				if (!index) {
					return json({ sessions: [] });
				}

				const sessions = index.entries
					.filter((e) => !e.isSidechain)
					.sort(
						(a, b) =>
							new Date(b.modified).getTime() - new Date(a.modified).getTime(),
					)
					.map((e) => ({
						sessionId: e.sessionId,
						firstPrompt: e.firstPrompt || "Untitled session",
						messageCount: e.messageCount || 0,
						created: e.created || e.modified,
						modified: e.modified,
						gitBranch: e.gitBranch,
					}));

				return json({ sessions });
			} catch (err) {
				console.error("Failed to list sessions:", err);
				return error(String(err));
			}
		},
	},

	// Switch to a specific session
	"/api/sessions/switch": {
		POST: async (req: Request) => {
			try {
				const { sessionId } = (await req.json()) as { sessionId: string };

				if (!sessionId) {
					return json({ error: "sessionId required" }, { status: 400 });
				}

				const index = await getSessionIndex();
				if (!index) {
					return json({ error: "No sessions found" }, { status: 404 });
				}

				const session = index.entries.find((e) => e.sessionId === sessionId);
				if (!session) {
					return json({ error: "Session not found" }, { status: 404 });
				}

				setActiveSession(sessionId);

				const cwd = getActiveSessionCwd();
				const { messages, isCompacted, firstPrompt } =
					await getSessionHistoryById(sessionId);
				return json({ ok: true, messages, cwd, isCompacted, firstPrompt });
			} catch (err) {
				console.error("Failed to switch session:", err);
				return error(String(err));
			}
		},
	},

	// Delete a specific session
	"/api/sessions/:sessionId": {
		DELETE: async (req: Request & { params: { sessionId: string } }) => {
			try {
				const { sessionId } = req.params;
				const url = new URL(req.url);
				const projectPath = url.searchParams.get("project");

				const cwd = projectPath ?? getActiveSessionCwd();
				const projectFolder = cwd.replace(/\//g, "-");
				const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
				const indexPath = join(claudeDir, "sessions-index.json");

				const indexFile = Bun.file(indexPath);
				if (!(await indexFile.exists())) {
					return json({ error: "No sessions found" }, { status: 404 });
				}

				const index: SessionIndex = await indexFile.json();
				const session = index.entries.find((e) => e.sessionId === sessionId);

				if (!session) {
					return json({ error: "Session not found" }, { status: 404 });
				}

				const wasActiveSession = getActiveSession() === sessionId;
				if (wasActiveSession) {
					setActiveSession(null);
				}

				const transcriptFile = Bun.file(session.fullPath);
				if (await transcriptFile.exists()) {
					await Bun.file(session.fullPath).delete();
				}

				const updatedIndex = {
					...index,
					entries: index.entries.filter((e) => e.sessionId !== sessionId),
				};

				await Bun.write(indexPath, JSON.stringify(updatedIndex, null, 2));

				return json({ ok: true, wasActiveSession });
			} catch (err) {
				console.error("Failed to delete session:", err);
				return error(String(err));
			}
		},
	},

	// Transcribe audio via Whisper
	"/api/transcribe": {
		POST: async (req: Request) => {
			try {
				const formData = await req.formData();
				const audioFile = formData.get("audio") as File;

				if (!audioFile) {
					return json({ error: "No audio file" }, { status: 400 });
				}

				console.debug(`POST /api/transcribe: ${audioFile.size} bytes`);

				// Convert WebM to WAV using FFmpeg (whisper.cpp requires WAV)
				const inputBuffer = await audioFile.arrayBuffer();
				const ffmpeg = Bun.spawn(
					[
						"ffmpeg",
						"-i",
						"pipe:0",
						"-ar",
						"16000",
						"-ac",
						"1",
						"-f",
						"wav",
						"pipe:1",
					],
					{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
				);
				ffmpeg.stdin.write(new Uint8Array(inputBuffer));
				ffmpeg.stdin.end();
				const wavBuffer = await new Response(ffmpeg.stdout).arrayBuffer();
				const exitCode = await ffmpeg.exited;
				if (exitCode !== 0) {
					const stderr = await new Response(ffmpeg.stderr).text();
					console.error("FFmpeg error:", stderr);
					return error("Audio conversion failed");
				}

				// Forward to Whisper server (whisper.cpp format)
				const whisperForm = new FormData();
				whisperForm.append(
					"file",
					new Blob([wavBuffer], { type: "audio/wav" }),
					"audio.wav",
				);
				whisperForm.append("response_format", "json");

				const whisperRes = await fetch(`${WHISPER_URL}/inference`, {
					method: "POST",
					body: whisperForm,
				});

				if (!whisperRes.ok) {
					const errText = await whisperRes.text();
					console.error("Whisper error:", errText);
					return error("Transcription failed");
				}

				const result = await whisperRes.json();
				const text = result.text || "";

				console.debug(`Transcribed: "${text.slice(0, 50)}..."`);
				return json({ text });
			} catch (err) {
				console.error("Transcribe error:", err);
				return error(String(err));
			}
		},
	},

	// Text-to-speech via Kokoro
	"/api/tts": {
		POST: async (req: Request) => {
			try {
				const { text } = (await req.json()) as { text: string };

				if (!text) {
					return json({ error: "No text provided" }, { status: 400 });
				}

				console.debug(`POST /api/tts: "${text.slice(0, 50)}..."`);

				const ttsRes = await fetch(KOKORO_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text }),
				});

				if (!ttsRes.ok) {
					const errText = await ttsRes.text();
					console.error("TTS error:", errText);
					return error("TTS failed");
				}

				const audioBuffer = await ttsRes.arrayBuffer();
				console.debug(`TTS response: ${audioBuffer.byteLength} bytes`);
				return new Response(audioBuffer, {
					headers: {
						...corsHeaders,
						"Content-Type": "audio/wav",
					},
				});
			} catch (err) {
				console.error("TTS error:", err);
				return error(String(err));
			}
		},
	},

	// Git status (for indicator)
	"/api/git/status": {
		GET: async () => {
			try {
				const diffProc = Bun.spawn(["git", "diff", "--numstat"], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});

				const diffOutput = await new Response(diffProc.stdout).text();
				await diffProc.exited;

				let insertions = 0;
				let deletions = 0;
				let filesChanged = 0;

				for (const line of diffOutput.trim().split("\n")) {
					if (!line) continue;
					const [added, removed] = line.split("\t");
					if (added !== "-") insertions += Number.parseInt(added) || 0;
					if (removed !== "-") deletions += Number.parseInt(removed) || 0;
					filesChanged++;
				}

				const untrackedProc = Bun.spawn(
					["git", "ls-files", "--others", "--exclude-standard"],
					{
						cwd: getActiveSessionCwd(),
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const untrackedOutput = await new Response(untrackedProc.stdout).text();
				await untrackedProc.exited;

				const untrackedFiles = untrackedOutput
					.trim()
					.split("\n")
					.filter(Boolean);
				filesChanged += untrackedFiles.length;

				const lineCounts = await Promise.all(
					untrackedFiles.map(async (filePath) => {
						try {
							const file = Bun.file(join(getActiveSessionCwd(), filePath));
							if (await file.exists()) {
								const content = await file.text();
								return content.split("\n").length;
							}
						} catch {
							// Skip files we can't read
						}
						return 0;
					}),
				);
				insertions += lineCounts.reduce((a, b) => a + b, 0);

				return json({
					hasChanges: filesChanged > 0,
					insertions,
					deletions,
					filesChanged,
				});
			} catch (err) {
				console.error("Git status error:", err);
				return error(String(err));
			}
		},
	},

	// Git diff (for modal)
	"/api/git/diff": {
		GET: async () => {
			try {
				const diffProc = Bun.spawn(["git", "diff"], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});
				const diffOutput = await new Response(diffProc.stdout).text();
				await diffProc.exited;

				const files = parseDiff(diffOutput);

				const untrackedProc = Bun.spawn(
					["git", "ls-files", "--others", "--exclude-standard"],
					{
						cwd: getActiveSessionCwd(),
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const untrackedOutput = await new Response(untrackedProc.stdout).text();
				await untrackedProc.exited;

				const untrackedFiles = untrackedOutput
					.trim()
					.split("\n")
					.filter(Boolean);

				const untrackedDiffs = await Promise.all(
					untrackedFiles.map(async (filePath) => {
						try {
							const file = Bun.file(join(getActiveSessionCwd(), filePath));
							if (await file.exists()) {
								const content = await file.text();
								const lines = content.split("\n");
								return {
									path: filePath,
									status: "added" as const,
									hunks: [
										{
											header: `@@ -0,0 +1,${lines.length} @@`,
											lines: lines.map((line, i) => ({
												type: "addition" as const,
												content: line,
												newLineNum: i + 1,
											})),
										},
									],
								};
							}
						} catch {
							// Skip files we can't read
						}
						return null;
					}),
				);
				files.push(...untrackedDiffs.filter((d): d is DiffFile => d !== null));

				return json({ files });
			} catch (err) {
				console.error("Git diff error:", err);
				return error(String(err));
			}
		},
	},

	// Git commit
	"/api/git/commit": {
		POST: async (req: Request) => {
			try {
				const { message } = (await req.json()) as { message: string };

				if (!message?.trim()) {
					return json({ error: "Commit message required" }, { status: 400 });
				}

				const addProc = Bun.spawn(["git", "add", "-A"], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});
				await addProc.exited;

				const commitProc = Bun.spawn(["git", "commit", "-m", message.trim()], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});

				const stdout = await new Response(commitProc.stdout).text();
				const stderr = await new Response(commitProc.stderr).text();
				const exitCode = await commitProc.exited;

				if (exitCode !== 0) {
					console.error("Git commit error:", stderr);
					return error(stderr || "Commit failed");
				}

				console.debug("Git commit:", stdout);
				return json({ ok: true, output: stdout });
			} catch (err) {
				console.error("Git commit error:", err);
				return error(String(err));
			}
		},
	},

	// List files in directory
	"/api/files": {
		GET: async (req: Request) => {
			try {
				const url = new URL(req.url);
				const relativePath = url.searchParams.get("path") || "";
				const cwd = getActiveSessionCwd();
				const fullPath = relativePath ? join(cwd, relativePath) : cwd;

				const entries = await readdir(fullPath, { withFileTypes: true });

				// Filter out dotfiles first
				const visibleEntries = entries.filter((e) => !e.name.startsWith("."));

				// Get paths for git check-ignore
				const pathsToCheck = visibleEntries.map((e) =>
					relativePath ? `${relativePath}/${e.name}` : e.name,
				);

				// Use git check-ignore to find which files are ignored
				const ignoredSet = new Set<string>();
				if (pathsToCheck.length > 0) {
					const checkIgnoreProc = Bun.spawn(
						["git", "check-ignore", "--stdin"],
						{
							cwd,
							stdin: "pipe",
							stdout: "pipe",
							stderr: "pipe",
						},
					);
					checkIgnoreProc.stdin.write(pathsToCheck.join("\n"));
					checkIgnoreProc.stdin.end();
					const ignoredOutput = await new Response(
						checkIgnoreProc.stdout,
					).text();
					await checkIgnoreProc.exited;

					for (const line of ignoredOutput.trim().split("\n")) {
						if (line) ignoredSet.add(line);
					}
				}

				const files = visibleEntries
					.filter((e) => {
						const entryPath = relativePath
							? `${relativePath}/${e.name}`
							: e.name;
						return !ignoredSet.has(entryPath);
					})
					.map((e) => ({
						name: e.name,
						path: relativePath ? `${relativePath}/${e.name}` : e.name,
						isDirectory: e.isDirectory(),
					}))
					.sort((a, b) => {
						if (a.isDirectory !== b.isDirectory) {
							return a.isDirectory ? -1 : 1;
						}
						return a.name.localeCompare(b.name);
					});

				return json({ files, path: relativePath });
			} catch (err) {
				console.error("List files error:", err);
				return error(String(err));
			}
		},
	},

	// Read file content
	"/api/file/*": {
		GET: async (req: Request) => {
			try {
				const url = new URL(req.url);
				const encodedPath = url.pathname.slice("/api/file/".length);
				const filePath = decodeURIComponent(encodedPath);
				const cwd = getActiveSessionCwd();

				const fullPath = filePath.startsWith("/")
					? filePath
					: join(cwd, filePath);
				const resolvedPath = (await Bun.file(fullPath).exists())
					? fullPath
					: null;

				if (!resolvedPath) {
					return json({ error: "File not found" }, { status: 404 });
				}

				if (!fullPath.startsWith(cwd) && !filePath.startsWith("/")) {
					return json({ error: "Access denied" }, { status: 403 });
				}

				const file = Bun.file(fullPath);
				const content = await file.text();

				return json({ content, path: fullPath });
			} catch (err) {
				console.error("File read error:", err);
				return error(String(err));
			}
		},
	},

	// List available projects from ~/projects/ with their sessions
	"/api/projects": {
		GET: async () => {
			try {
				const projectsDir = join(homedir(), "projects");

				const fdProc = Bun.spawn(
					[
						"fd",
						"--type",
						"d",
						"--hidden",
						"--no-ignore",
						"^.git$",
						projectsDir,
					],
					{ stdout: "pipe", stderr: "pipe" },
				);
				const fdOutput = await new Response(fdProc.stdout).text();
				await fdProc.exited;

				const projectPaths = fdOutput
					.trim()
					.split("\n")
					.filter(Boolean)
					.map((gitDir) => gitDir.replace(/\/.git\/?$/, ""));

				const projectNames = projectPaths
					.map((p) => p.replace(`${projectsDir}/`, ""))
					.sort((a, b) => a.localeCompare(b));

				type SessionInfo = {
					sessionId: string;
					firstPrompt: string;
					messageCount: number;
					created: string;
					modified: string;
					gitBranch?: string;
				};
				type ProjectWithSessions = {
					name: string;
					path: string;
					sessions: SessionInfo[];
				};

				const projects: ProjectWithSessions[] = [];

				for (const name of projectNames) {
					const projectPath = join(projectsDir, name);
					const projectFolder = projectPath.replace(/\//g, "-");
					const claudeDir = join(
						homedir(),
						".claude",
						"projects",
						projectFolder,
					);
					const indexPath = join(claudeDir, "sessions-index.json");

					const projectData: ProjectWithSessions = {
						name,
						path: projectPath,
						sessions: [],
					};

					try {
						const indexFile = Bun.file(indexPath);
						if (await indexFile.exists()) {
							const index: SessionIndex = await indexFile.json();
							projectData.sessions = index.entries
								.filter((e) => !e.isSidechain)
								.sort(
									(a, b) =>
										new Date(b.modified).getTime() -
										new Date(a.modified).getTime(),
								)
								.map((e) => ({
									sessionId: e.sessionId,
									firstPrompt: e.firstPrompt || "Untitled session",
									messageCount: e.messageCount || 0,
									created: e.created || e.modified,
									modified: e.modified,
									gitBranch: e.gitBranch,
								}));
						}
					} catch {
						// No sessions for this project
					}

					projects.push(projectData);
				}

				const currentCwd = getActiveSessionCwd();
				const currentProject = currentCwd.startsWith(projectsDir)
					? currentCwd.replace(`${projectsDir}/`, "")
					: currentCwd.split("/").pop();

				return json({
					projects,
					currentProject,
					activeSessionId: getActiveSession(),
				});
			} catch (err) {
				console.error("Failed to list projects:", err);
				return error(String(err));
			}
		},
	},

	// Switch to a different project
	"/api/projects/switch": {
		POST: async (req: Request) => {
			try {
				const { project } = (await req.json()) as { project: string };

				if (!project) {
					return json({ error: "project name required" }, { status: 400 });
				}

				const projectPath = join(homedir(), "projects", project);

				const proc = Bun.spawn(["test", "-d", projectPath]);
				if ((await proc.exited) !== 0) {
					return json({ error: "Project not found" }, { status: 404 });
				}

				setActiveSession(null, projectPath);

				return json({ ok: true, cwd: projectPath });
			} catch (err) {
				console.error("Failed to switch project:", err);
				return error(String(err));
			}
		},
	},

	// CORS preflight handler
	"/api/*": {
		OPTIONS: () => new Response(null, { headers: corsHeaders }),
	},
};

// Fallback for unmatched API routes
export const apiFallback = () => json({ error: "Not found" }, { status: 404 });
