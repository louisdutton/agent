import { homedir } from "node:os";
import { join } from "node:path";
import { sendMessage } from "./claude";
import {
	cancelCurrentRequest,
	clearSession,
	getActiveSession,
	getActiveSessionCwd,
	setActiveSession,
} from "./session";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:8080";
const KOKORO_URL = process.env.KOKORO_URL || "http://localhost:8880";

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

// Get Claude session history from ~/.claude/projects/
async function getSessionHistory() {
	const cwd = getActiveSessionCwd();
	const projectFolder = cwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
	const indexPath = join(claudeDir, "sessions-index.json");

	try {
		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) return [];

		const index = await indexFile.json();
		const sessions = index.entries
			.filter((e: { isSidechain: boolean }) => !e.isSidechain)
			.sort(
				(a: { modified: string }, b: { modified: string }) =>
					new Date(b.modified).getTime() - new Date(a.modified).getTime(),
			);

		if (sessions.length === 0) return [];

		const latestSession = sessions[0];
		const transcriptPath = latestSession.fullPath;
		const transcriptFile = Bun.file(transcriptPath);
		if (!(await transcriptFile.exists())) return [];

		const content = await transcriptFile.text();
		const lines = content.trim().split("\n").filter(Boolean);

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
		const messages: Message[] = [];

		// Track tool results to update tool status
		const toolResults = new Map<string, boolean>(); // toolUseId -> isError

		// First pass: collect all tool results
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "user" && entry.message?.content) {
					const content = entry.message.content;
					// Handle array content (tool results)
					if (Array.isArray(content)) {
						for (const block of content) {
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

		// Second pass: build messages with correct tool statuses
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "user" && entry.message?.content) {
					const content = entry.message.content;
					// Handle string content (regular user messages)
					if (typeof content === "string") {
						// Skip meta/command messages
						if (!entry.isMeta && !content.startsWith("<")) {
							messages.push({ type: "user", id: entry.uuid, content });
						}
					} else if (Array.isArray(content)) {
						// Handle array content (messages with text blocks)
						const textBlocks = content.filter(
							(b: { type: string }) => b.type === "text",
						);
						const text = textBlocks.map((b: { text: string }) => b.text).join("");
						if (text) {
							messages.push({ type: "user", id: entry.uuid, content: text });
						}
					}
				} else if (entry.type === "assistant" && entry.message?.content) {
					const content = entry.message.content;
					if (!Array.isArray(content)) continue;

					// Extract text content
					const textBlocks = content.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "assistant", id: entry.uuid, content: text });
					}

					// Extract tool uses
					const toolUses = content.filter(
						(b: { type: string }) => b.type === "tool_use",
					);
					if (toolUses.length > 0) {
						const tools: Tool[] = toolUses.map(
							(t: { id: string; name: string; input: Record<string, unknown> }) => ({
								toolUseId: t.id,
								name: t.name,
								input: t.input || {},
								status: toolResults.has(t.id)
									? toolResults.get(t.id)
										? "error"
										: "complete"
									: "complete", // Default to complete for historical tools
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

		// Merge consecutive tool groups (mimics live streaming behavior)
		const mergedMessages: Message[] = [];
		for (const msg of messages) {
			const last = mergedMessages[mergedMessages.length - 1];
			if (msg.type === "tools" && last && last.type === "tools") {
				// Merge tools into the previous group
				mergedMessages[mergedMessages.length - 1] = {
					...last,
					tools: [...last.tools, ...msg.tools],
				};
			} else {
				mergedMessages.push(msg);
			}
		}

		return mergedMessages;
	} catch (err) {
		console.error("Error reading session history:", err);
		return [];
	}
}

// Get session history by specific session ID
async function getSessionHistoryById(sessionId: string) {
	const cwd = getActiveSessionCwd();
	const projectFolder = cwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
	const indexPath = join(claudeDir, "sessions-index.json");

	try {
		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) return [];

		const index = await indexFile.json();
		const session = index.entries.find(
			(e: { sessionId: string }) => e.sessionId === sessionId,
		);

		if (!session) return [];

		const transcriptFile = Bun.file(session.fullPath);
		if (!(await transcriptFile.exists())) return [];

		const content = await transcriptFile.text();
		const lines = content.trim().split("\n").filter(Boolean);

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
		const messages: Message[] = [];

		// Track tool results to update tool status
		const toolResults = new Map<string, boolean>();

		// First pass: collect all tool results
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "user" && entry.message?.content) {
					const content = entry.message.content;
					if (Array.isArray(content)) {
						for (const block of content) {
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

		// Second pass: build messages
		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "user" && entry.message?.content) {
					const content = entry.message.content;
					if (typeof content === "string") {
						if (!entry.isMeta && !content.startsWith("<")) {
							messages.push({ type: "user", id: entry.uuid, content });
						}
					} else if (Array.isArray(content)) {
						const textBlocks = content.filter(
							(b: { type: string }) => b.type === "text",
						);
						const text = textBlocks.map((b: { text: string }) => b.text).join("");
						if (text) {
							messages.push({ type: "user", id: entry.uuid, content: text });
						}
					}
				} else if (entry.type === "assistant" && entry.message?.content) {
					const content = entry.message.content;
					if (!Array.isArray(content)) continue;

					const textBlocks = content.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "assistant", id: entry.uuid, content: text });
					}

					const toolUses = content.filter(
						(b: { type: string }) => b.type === "tool_use",
					);
					if (toolUses.length > 0) {
						const tools: Tool[] = toolUses.map(
							(t: { id: string; name: string; input: Record<string, unknown> }) => ({
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

		// Merge consecutive tool groups (mimics live streaming behavior)
		const mergedMessages: Message[] = [];
		for (const msg of messages) {
			const last = mergedMessages[mergedMessages.length - 1];
			if (msg.type === "tools" && last && last.type === "tools") {
				// Merge tools into the previous group
				mergedMessages[mergedMessages.length - 1] = {
					...last,
					tools: [...last.tools, ...msg.tools],
				};
			} else {
				mergedMessages.push(msg);
			}
		}

		return mergedMessages;
	} catch (err) {
		console.error("Error reading session history by ID:", err);
		return [];
	}
}

export default {
	async fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const path = url.pathname.replace(/^\/api/, "");

		if (req.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		// Send message
		if (path === "/messages" && req.method === "POST") {
			const body = (await req.json()) as { message: string };
			console.log(`POST /api/messages:`, body.message?.slice(0, 50));

			try {
				const encoder = new TextEncoder();
				const stream = new ReadableStream({
					async start(controller) {
						try {
							for await (const line of sendMessage(body.message)) {
								controller.enqueue(encoder.encode(`data: ${line}\n\n`));
							}
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						} catch (err) {
							console.error("Stream error:", err);
							controller.enqueue(
								encoder.encode(`data: {"error": "${String(err)}"}\n\n`),
							);
						} finally {
							controller.close();
						}
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
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Get session history
		if (path === "/history" && req.method === "GET") {
			const messages = await getSessionHistory();
			return Response.json({ messages }, { headers: corsHeaders });
		}

		// Cancel current request
		if (path === "/cancel" && req.method === "POST") {
			const cancelled = cancelCurrentRequest();
			return Response.json({ cancelled }, { headers: corsHeaders });
		}

		// Clear session
		if (
			(path === "/session" && req.method === "DELETE") ||
			(path === "/clear" && req.method === "POST")
		) {
			try {
				await clearSession();
				return Response.json({ ok: true }, { headers: corsHeaders });
			} catch (err) {
				console.error("Failed to clear session:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Create a new session with a specific cwd
		if (path === "/sessions/new" && req.method === "POST") {
			try {
				const { cwd } = (await req.json()) as { cwd?: string };

				// Validate directory exists if cwd is provided
				if (cwd) {
					const proc = Bun.spawn(["test", "-d", cwd]);
					const exitCode = await proc.exited;
					if (exitCode !== 0) {
						return Response.json(
							{ error: "Directory does not exist" },
							{ status: 400, headers: corsHeaders },
						);
					}
				}

				// Clear active session and set new cwd
				setActiveSession(null, cwd || getActiveSessionCwd());
				return Response.json({ ok: true, cwd: cwd || getActiveSessionCwd() }, { headers: corsHeaders });
			} catch (err) {
				console.error("Failed to create new session:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// List all sessions
		if (path === "/sessions" && req.method === "GET") {
			try {
				const cwd = getActiveSessionCwd();
				const projectFolder = cwd.replace(/\//g, "-");
				const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
				const indexPath = join(claudeDir, "sessions-index.json");

				const indexFile = Bun.file(indexPath);
				if (!(await indexFile.exists())) {
					return Response.json({ sessions: [] }, { headers: corsHeaders });
				}

				const index = await indexFile.json();
				const sessions = index.entries
					.filter((e: { isSidechain: boolean }) => !e.isSidechain)
					.sort(
						(a: { modified: string }, b: { modified: string }) =>
							new Date(b.modified).getTime() - new Date(a.modified).getTime(),
					)
					.map(
						(e: {
							sessionId: string;
							firstPrompt?: string;
							messageCount?: number;
							created?: string;
							modified: string;
							gitBranch?: string;
							projectPath?: string;
						}) => ({
							sessionId: e.sessionId,
							firstPrompt: e.firstPrompt || "Untitled session",
							messageCount: e.messageCount || 0,
							created: e.created || e.modified,
							modified: e.modified,
							gitBranch: e.gitBranch,
							cwd: e.projectPath || cwd,
						}),
					);

				return Response.json({ sessions }, { headers: corsHeaders });
			} catch (err) {
				console.error("Failed to list sessions:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Switch to a specific session
		if (path === "/sessions/switch" && req.method === "POST") {
			try {
				const { sessionId } = (await req.json()) as { sessionId: string };

				if (!sessionId) {
					return Response.json(
						{ error: "sessionId required" },
						{ status: 400, headers: corsHeaders },
					);
				}

				// Validate session exists
				const cwd = getActiveSessionCwd();
				const projectFolder = cwd.replace(/\//g, "-");
				const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
				const indexPath = join(claudeDir, "sessions-index.json");

				const indexFile = Bun.file(indexPath);
				let sessionCwd = cwd;
				if (await indexFile.exists()) {
					const index = await indexFile.json();
					const session = index.entries.find(
						(e: { sessionId: string }) => e.sessionId === sessionId,
					);
					if (!session) {
						return Response.json(
							{ error: "Session not found" },
							{ status: 404, headers: corsHeaders },
						);
					}
					// Use the session's stored cwd if available
					sessionCwd = session.projectPath || cwd;
				} else {
					return Response.json(
						{ error: "No sessions found" },
						{ status: 404, headers: corsHeaders },
					);
				}

				// Set active session with its cwd
				setActiveSession(sessionId, sessionCwd);

				// Return the session's messages for UI update
				const messages = await getSessionHistoryById(sessionId);
				return Response.json({ ok: true, messages, cwd: sessionCwd }, { headers: corsHeaders });
			} catch (err) {
				console.error("Failed to switch session:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Delete a specific session
		if (path.startsWith("/sessions/") && req.method === "DELETE") {
			try {
				const sessionId = path.replace("/sessions/", "");

				const cwd = getActiveSessionCwd();
				const projectFolder = cwd.replace(/\//g, "-");
				const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
				const indexPath = join(claudeDir, "sessions-index.json");

				const indexFile = Bun.file(indexPath);
				if (!(await indexFile.exists())) {
					return Response.json(
						{ error: "No sessions found" },
						{ status: 404, headers: corsHeaders },
					);
				}

				const index = await indexFile.json();
				const session = index.entries.find(
					(e: { sessionId: string }) => e.sessionId === sessionId,
				);

				if (!session) {
					return Response.json(
						{ error: "Session not found" },
						{ status: 404, headers: corsHeaders },
					);
				}

				// Check if this is the currently active session
				const wasActiveSession = getActiveSession() === sessionId;
				if (wasActiveSession) {
					setActiveSession(null);
				}

				// Delete the transcript file
				const transcriptFile = Bun.file(session.fullPath);
				if (await transcriptFile.exists()) {
					await Bun.file(session.fullPath).delete();
				}

				// Update the index
				const updatedIndex = {
					...index,
					entries: index.entries.filter(
						(e: { sessionId: string }) => e.sessionId !== sessionId,
					),
				};

				await Bun.write(indexPath, JSON.stringify(updatedIndex, null, 2));

				return Response.json({ ok: true, wasActiveSession }, { headers: corsHeaders });
			} catch (err) {
				console.error("Failed to delete session:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Transcribe audio via Whisper
		if (path === "/transcribe" && req.method === "POST") {
			try {
				const formData = await req.formData();
				const audioFile = formData.get("audio") as File;

				if (!audioFile) {
					return Response.json(
						{ error: "No audio file" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(`POST /api/transcribe: ${audioFile.size} bytes`);

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
					return Response.json(
						{ error: "Audio conversion failed" },
						{ status: 500, headers: corsHeaders },
					);
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
					return Response.json(
						{ error: "Transcription failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const result = await whisperRes.json();
				const text = result.text || "";

				console.log(`Transcribed: "${text.slice(0, 50)}..."`);
				return Response.json({ text }, { headers: corsHeaders });
			} catch (err) {
				console.error("Transcribe error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Text-to-speech via Kokoro
		if (path === "/tts" && req.method === "POST") {
			try {
				const { text } = (await req.json()) as { text: string };

				if (!text) {
					return Response.json(
						{ error: "No text provided" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(`POST /api/tts: "${text.slice(0, 50)}..."`);

				// Forward to TTS server (Piper)
				const ttsRes = await fetch(KOKORO_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text }),
				});

				if (!ttsRes.ok) {
					const errText = await ttsRes.text();
					console.error("TTS error:", errText);
					return Response.json(
						{ error: "TTS failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const audioBuffer = await ttsRes.arrayBuffer();
				console.log(`TTS response: ${audioBuffer.byteLength} bytes`);
				return new Response(audioBuffer, {
					headers: {
						...corsHeaders,
						"Content-Type": "audio/wav",
					},
				});
			} catch (err) {
				console.error("TTS error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Git status (for indicator)
		if (path === "/git/status" && req.method === "GET") {
			try {
				// Get stats for tracked file changes
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

				// Get untracked files and count their lines
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

				const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean);
				filesChanged += untrackedFiles.length;

				// Count lines in untracked files
				for (const filePath of untrackedFiles) {
					try {
						const file = Bun.file(join(getActiveSessionCwd(), filePath));
						if (await file.exists()) {
							const content = await file.text();
							insertions += content.split("\n").length;
						}
					} catch {
						// Skip files we can't read
					}
				}

				return Response.json(
					{ hasChanges: filesChanged > 0, insertions, deletions, filesChanged },
					{ headers: corsHeaders },
				);
			} catch (err) {
				console.error("Git status error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Git diff (for modal)
		if (path === "/git/diff" && req.method === "GET") {
			try {
				// Get diff for tracked files
				const diffProc = Bun.spawn(["git", "diff"], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});
				const diffOutput = await new Response(diffProc.stdout).text();
				await diffProc.exited;

				const files = parseDiff(diffOutput);

				// Get untracked files
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

				const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean);

				// Generate diff-like output for untracked files
				for (const filePath of untrackedFiles) {
					try {
						const file = Bun.file(join(getActiveSessionCwd(), filePath));
						if (await file.exists()) {
							const content = await file.text();
							const lines = content.split("\n");
							const hunks: DiffHunk[] = [
								{
									header: `@@ -0,0 +1,${lines.length} @@`,
									lines: lines.map((line, i) => ({
										type: "addition" as const,
										content: line,
										newLineNum: i + 1,
									})),
								},
							];
							files.push({
								path: filePath,
								status: "added",
								hunks,
							});
						}
					} catch {
						// Skip files we can't read
					}
				}

				return Response.json({ files }, { headers: corsHeaders });
			} catch (err) {
				console.error("Git diff error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Git commit
		if (path === "/git/commit" && req.method === "POST") {
			try {
				const { message } = (await req.json()) as { message: string };

				if (!message?.trim()) {
					return Response.json(
						{ error: "Commit message required" },
						{ status: 400, headers: corsHeaders },
					);
				}

				// Stage all changes
				const addProc = Bun.spawn(["git", "add", "-A"], {
					cwd: getActiveSessionCwd(),
					stdout: "pipe",
					stderr: "pipe",
				});
				await addProc.exited;

				// Commit
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
					return Response.json(
						{ error: stderr || "Commit failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				console.log("Git commit:", stdout);
				return Response.json({ ok: true, output: stdout }, { headers: corsHeaders });
			} catch (err) {
				console.error("Git commit error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		return Response.json(
			{ error: "Not found" },
			{ status: 404, headers: corsHeaders },
		);
	},
};
