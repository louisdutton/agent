import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { compactSession, sendMessage } from "./claude";
import { listProjects, PROJECTS_DIR } from "./files";
import {
	createBranch,
	deleteBranch,
	getBranches,
	getCommitDetails,
	getCurrentBranch,
	getGitFiles,
	getGitLog,
	getStashes,
	gitCherryPick,
	gitFetch,
	gitPull,
	gitPush,
	gitReset,
	gitRevert,
	mergeBranch,
	stashApply,
	stashDrop,
	stashPop,
	stashSave,
	switchBranch,
} from "./git";
import {
	cancelSession,
	clearSessionById,
	getCwd,
	getSessionHistoryById,
	getSessionsFromTranscripts,
	isSessionActive,
	setCwd,
} from "./session";
import { corsHeaders, EMPTY, error, json } from "./util";

const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9371";
const KOKORO_URL = process.env.KOKORO_URL || "http://localhost:9372";

// Declarative API routes
export const routes = {
	// List all sessions for current project
	"/api/sessions": {
		GET: async () => {
			try {
				const cwd = getCwd();
				const allSessions = await getSessionsFromTranscripts();
				const sorted = allSessions
					.filter((e) => !e.isSidechain)
					.sort(
						(a, b) =>
							new Date(b.modified).getTime() - new Date(a.modified).getTime(),
					);

				const sessions = sorted.map((e) => ({
					sessionId: e.sessionId,
					firstPrompt: e.firstPrompt || "Untitled session",
					created: e.created,
					modified: e.modified,
					gitBranch: e.gitBranch,
				}));

				return json({
					sessions,
					cwd,
					latestSessionId: sorted[0]?.sessionId,
				});
			} catch (err) {
				console.error("Failed to list sessions:", err);
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
				const projectPath = url.searchParams.get("project") ?? getCwd();

				await clearSessionById(sessionId, projectPath);

				return json({ ok: true });
			} catch (err) {
				console.error("Failed to delete session:", err);
				return error(String(err));
			}
		},
	},

	// Session history by ID
	"/api/sessions/:sessionId/history": {
		GET: async (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const cwd = getCwd();
			const { messages, isCompacted, firstPrompt } =
				await getSessionHistoryById(sessionId);
			return json({ messages, cwd, sessionId, isCompacted, firstPrompt });
		},
	},

	// Session status
	"/api/sessions/:sessionId/status": {
		GET: (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const busy = isSessionActive(sessionId);
			return json({ busy });
		},
	},

	// Send message (streaming)
	"/api/sessions/:sessionId/messages": {
		POST: async (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const body = (await req.json()) as {
				message: string;
				images?: string[];
			};
			console.debug(
				`POST /api/sessions/${sessionId}/messages:`,
				body.message?.slice(0, 50),
				body.images?.length ? `(${body.images.length} images)` : "",
			);

			try {
				const encoder = new TextEncoder();
				let controllerClosed = false;
				const stream = new ReadableStream({
					async start(controller) {
						try {
							// "new" is a special value meaning create a new session
							const resolvedSessionId = sessionId === "new" ? null : sessionId;
							for await (const line of sendMessage(
								body.message,
								resolvedSessionId,
								body.images,
							)) {
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

	// Cancel a session's request
	"/api/sessions/:sessionId/cancel": {
		POST: (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const cancelled = cancelSession(sessionId);
			return json({ cancelled });
		},
	},

	// Compact session context
	"/api/sessions/:sessionId/compact": {
		POST: async (req: Request & { params: { sessionId: string } }) => {
			const { sessionId } = req.params;
			const result = await compactSession(sessionId);
			if (result.success) {
				return json({ ok: true });
			}
			return error(result.error || "Compaction failed");
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

				console.debug(
					`POST /api/transcribe: ${audioFile.size} bytes, type: ${audioFile.type}`,
				);

				// Forward to Whisper server (whisper.cpp with ffmpeg support handles format conversion)
				const whisperForm = new FormData();
				whisperForm.append("file", audioFile);
				whisperForm.append("response_format", "json");
				whisperForm.append("language", "en");
				whisperForm.append(
					"prompt",
					"A software engineer is discussing code, programming, and AI with Claude.",
				);

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
				const cwd = getCwd();
				const diffProc = Bun.spawn(["git", "diff", "--numstat"], {
					cwd,
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
					if (added !== "-") insertions += Number.parseInt(added, 10) || 0;
					if (removed !== "-") deletions += Number.parseInt(removed, 10) || 0;
					filesChanged++;
				}

				const untrackedProc = Bun.spawn(
					["git", "ls-files", "--others", "--exclude-standard"],
					{
						cwd,
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
							const file = Bun.file(join(cwd, filePath));
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
				const files = await getGitFiles();
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

				const cwd = getCwd();
				const addProc = Bun.spawn(["git", "add", "-A"], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
				});
				await addProc.exited;

				const commitProc = Bun.spawn(["git", "commit", "-m", message.trim()], {
					cwd,
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

	// Git log (commit history)
	"/api/git/log": {
		GET: async (req: Request) => {
			try {
				const url = new URL(req.url);
				const count = Number.parseInt(
					url.searchParams.get("count") || "50",
					10,
				);
				const branch = url.searchParams.get("branch") || undefined;
				const commits = await getGitLog(count, branch);
				const currentBranch = await getCurrentBranch();
				return json({ commits, currentBranch });
			} catch (err) {
				console.error("Git log error:", err);
				return error(String(err));
			}
		},
	},

	// Git commit details
	"/api/git/commits/:hash": {
		GET: async (req: Request & { params: { hash: string } }) => {
			try {
				const { hash } = req.params;
				const details = await getCommitDetails(hash);
				return json(details);
			} catch (err) {
				console.error("Git commit details error:", err);
				return error(String(err));
			}
		},
	},

	// Git branches
	"/api/git/branches": {
		GET: async () => {
			try {
				const branches = await getBranches();
				const current = await getCurrentBranch();
				return json({ branches, current });
			} catch (err) {
				console.error("Git branches error:", err);
				return error(String(err));
			}
		},
		POST: async (req: Request) => {
			try {
				const { name, startPoint } = (await req.json()) as {
					name: string;
					startPoint?: string;
				};
				if (!name?.trim()) {
					return json({ error: "Branch name required" }, { status: 400 });
				}
				await createBranch(name.trim(), startPoint);
				return json({ ok: true });
			} catch (err) {
				console.error("Git create branch error:", err);
				return error(String(err));
			}
		},
	},

	// Git branch operations
	"/api/git/branches/:name": {
		DELETE: async (req: Request & { params: { name: string } }) => {
			try {
				const { name } = req.params;
				const url = new URL(req.url);
				const force = url.searchParams.get("force") === "true";
				await deleteBranch(decodeURIComponent(name), force);
				return json({ ok: true });
			} catch (err) {
				console.error("Git delete branch error:", err);
				return error(String(err));
			}
		},
	},

	// Switch branch
	"/api/git/checkout": {
		POST: async (req: Request) => {
			try {
				const { branch } = (await req.json()) as { branch: string };
				if (!branch?.trim()) {
					return json({ error: "Branch name required" }, { status: 400 });
				}
				await switchBranch(branch.trim());
				return json({ ok: true });
			} catch (err) {
				console.error("Git checkout error:", err);
				return error(String(err));
			}
		},
	},

	// Merge branch
	"/api/git/merge": {
		POST: async (req: Request) => {
			try {
				const { branch } = (await req.json()) as { branch: string };
				if (!branch?.trim()) {
					return json({ error: "Branch name required" }, { status: 400 });
				}
				const result = await mergeBranch(branch.trim());
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git merge error:", err);
				return error(String(err));
			}
		},
	},

	// Git stashes
	"/api/git/stashes": {
		GET: async () => {
			try {
				const stashes = await getStashes();
				return json({ stashes });
			} catch (err) {
				console.error("Git stashes error:", err);
				return error(String(err));
			}
		},
		POST: async (req: Request) => {
			try {
				const { message } = (await req.json()) as { message?: string };
				await stashSave(message);
				return json({ ok: true });
			} catch (err) {
				console.error("Git stash save error:", err);
				return error(String(err));
			}
		},
	},

	// Stash operations
	"/api/git/stashes/:index": {
		POST: async (req: Request & { params: { index: string } }) => {
			try {
				const index = Number.parseInt(req.params.index, 10);
				const { action } = (await req.json()) as {
					action: "pop" | "apply" | "drop";
				};

				if (action === "pop") {
					await stashPop(index);
				} else if (action === "apply") {
					await stashApply(index);
				} else if (action === "drop") {
					await stashDrop(index);
				} else {
					return json({ error: "Invalid action" }, { status: 400 });
				}

				return json({ ok: true });
			} catch (err) {
				console.error("Git stash operation error:", err);
				return error(String(err));
			}
		},
	},

	// Git pull
	"/api/git/pull": {
		POST: async () => {
			try {
				const result = await gitPull();
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git pull error:", err);
				return error(String(err));
			}
		},
	},

	// Git push
	"/api/git/push": {
		POST: async (req: Request) => {
			try {
				const { force, setUpstream } = (await req.json()) as {
					force?: boolean;
					setUpstream?: boolean;
				};
				const result = await gitPush(force, setUpstream);
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git push error:", err);
				return error(String(err));
			}
		},
	},

	// Git fetch
	"/api/git/fetch": {
		POST: async () => {
			try {
				const result = await gitFetch();
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git fetch error:", err);
				return error(String(err));
			}
		},
	},

	// Git reset
	"/api/git/reset": {
		POST: async (req: Request) => {
			try {
				const { hash, mode } = (await req.json()) as {
					hash: string;
					mode?: "soft" | "mixed" | "hard";
				};
				if (!hash?.trim()) {
					return json({ error: "Commit hash required" }, { status: 400 });
				}
				await gitReset(hash.trim(), mode || "mixed");
				return json({ ok: true });
			} catch (err) {
				console.error("Git reset error:", err);
				return error(String(err));
			}
		},
	},

	// Git cherry-pick
	"/api/git/cherry-pick": {
		POST: async (req: Request) => {
			try {
				const { hash } = (await req.json()) as { hash: string };
				if (!hash?.trim()) {
					return json({ error: "Commit hash required" }, { status: 400 });
				}
				const result = await gitCherryPick(hash.trim());
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git cherry-pick error:", err);
				return error(String(err));
			}
		},
	},

	// Git revert
	"/api/git/revert": {
		POST: async (req: Request) => {
			try {
				const { hash } = (await req.json()) as { hash: string };
				if (!hash?.trim()) {
					return json({ error: "Commit hash required" }, { status: 400 });
				}
				const result = await gitRevert(hash.trim());
				return json({ ok: true, output: result });
			} catch (err) {
				console.error("Git revert error:", err);
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
				const cwd = getCwd();
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
				const cwd = getCwd();

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
				const currentCwd = getCwd();
				const currentProject = currentCwd.startsWith(PROJECTS_DIR)
					? currentCwd.replace(`${PROJECTS_DIR}/`, "")
					: currentCwd.split("/").pop();

				const projects = await listProjects();

				return json({
					projects,
					currentProject,
				});
			} catch (err) {
				console.error("Failed to list projects:", err);
				return error(String(err));
			}
		},
	},

	// Switch to a different project (just updates cwd)
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

				setCwd(projectPath);

				return json({ ok: true, cwd: projectPath });
			} catch (err) {
				console.error("Failed to switch project:", err);
				return error(String(err));
			}
		},
	},

	// CORS preflight handler
	"/api/*": {
		OPTIONS: () => EMPTY,
	},
};

// Fallback for unmatched API routes
export const apiFallback = () => json({ error: "Not found" }, { status: 404 });
