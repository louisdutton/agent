import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	type AudioRefs,
	createAudioRefs,
	playTTS,
	startRecording,
	stopPlayback,
	stopRecording,
} from "./audio";
import {
	FileBrowserModal,
	FileViewerModal,
	GitDiffModal,
	GitStatusIndicator,
	useGitStatus,
} from "./git";
import { GitPanel } from "./git-panel";
import { ImagePickerButton, ImagePreview } from "./image-attachment";
import { Markdown } from "./markdown";
import { notifyClaudeError, notifyClaudeFinished } from "./notifications";
import {
	MicButton,
	OptionsMenu,
	OptionsMenuButton,
	type VoiceStatus,
} from "./round-buttons";
import { ThreadListPanel } from "./thread-list";
import { ToolGroup } from "./tools";
import type { EventItem, Thread, Tool, ToolStatus } from "./types";
import { connectionStatus, initWebSocket } from "./ws";

// Helper to build URL with project query param
function apiUrl(path: string, projectPath: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}project=${encodeURIComponent(projectPath)}`;
}

export function App() {
	// Core state
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [projectPath, setProjectPath] = createSignal("");
	const [sessionName, setSessionName] = createSignal("");
	const [isCompacted, setIsCompacted] = createSignal(false);

	// Thread state - null means viewing the main assistant
	const [activeThread, setActiveThread] = createSignal<Thread | null>(null);
	const [showThreadList, setShowThreadList] = createSignal(false);

	// UI state
	const [showMenu, setShowMenu] = createSignal(false);
	const [showTextInput, setShowTextInput] = createSignal(false);
	const [isCompacting, setIsCompacting] = createSignal(false);
	const [isClearing, setIsClearing] = createSignal(false);
	const [attachedImages, setAttachedImages] = createSignal<string[]>([]);

	// Audio state
	const [isRecording, setIsRecording] = createSignal(false);
	const [isTranscribing, setIsTranscribing] = createSignal(false);
	const [pendingVoiceInput, setPendingVoiceInput] = createSignal(false);
	const [playingId, setPlayingId] = createSignal<string | null>(null);
	const [isPlaying, setIsPlaying] = createSignal(false);
	const [audioLevels, setAudioLevels] = createSignal<number[]>([0, 0, 0, 0]);

	// Git state
	const gitStatus = useGitStatus(projectPath);
	const [showDiffModal, setShowDiffModal] = createSignal(false);
	const [showGitPanel, setShowGitPanel] = createSignal(false);

	// File viewer state
	const [showFileBrowser, setShowFileBrowser] = createSignal(false);
	const [showFileViewer, setShowFileViewer] = createSignal(false);
	const [fileViewerPath, setFileViewerPath] = createSignal("");

	let mainRef: HTMLElement | undefined;
	let menuRef: HTMLDivElement | undefined;
	let idCounter = 0;
	let abortController: AbortController | null = null;
	let threadEventSource: EventSource | null = null;

	const audioRefs: AudioRefs = createAudioRefs();
	const audioState = {
		isRecording,
		setIsRecording,
		isTranscribing,
		setIsTranscribing,
		isPlaying,
		setIsPlaying,
		playingId,
		setPlayingId,
		audioLevels,
		setAudioLevels,
		pendingVoiceInput,
		setPendingVoiceInput,
		setInput,
	};

	// Derived state
	const isBackgroundThread = () => activeThread()?.type === "worker";

	// Event handling helpers (shared between assistant and worker)
	const addEvent = (event: EventItem) => {
		setEvents((prev) => [...prev, event]);
	};

	const addOrUpdateToolGroup = (tool: Tool) => {
		setEvents((prev) => {
			const last = prev[prev.length - 1];
			if (last?.type === "tools") {
				return [
					...prev.slice(0, -1),
					{ ...last, tools: [...last.tools, tool] },
				];
			}
			return [
				...prev,
				{ type: "tools", id: String(++idCounter), tools: [tool] },
			];
		});
	};

	const updateToolStatus = (
		toolUseId: string,
		status: ToolStatus,
		resultImages?: string[],
	) => {
		setEvents((prev) =>
			prev.map((e) => {
				if (e.type === "tools") {
					return {
						...e,
						tools: e.tools.map((t) =>
							t.toolUseId === toolUseId
								? { ...t, status, resultImages: resultImages ?? t.resultImages }
								: t,
						),
					};
				}
				return e;
			}),
		);
	};

	const markAllToolsComplete = () => {
		setEvents((prev) =>
			prev.map((e) => {
				if (e.type === "tools") {
					return {
						...e,
						tools: e.tools.map((t) =>
							t.status === "running"
								? { ...t, status: "complete" as ToolStatus }
								: t,
						),
					};
				}
				return e;
			}),
		);
	};

	const getSessionNameFromEvents = (messages: EventItem[]) => {
		const firstUser = messages.find((m) => m.type === "user");
		if (firstUser && firstUser.type === "user") {
			const content = firstUser.content;
			return content.length > 50 ? `${content.slice(0, 50)}...` : content;
		}
		return "";
	};

	// Process streaming data (shared format for both assistant and worker)
	const processStreamEvent = (
		parsed: Record<string, unknown>,
		assistantContentRef: { value: string },
	) => {
		// Handle streaming text
		if (parsed.type === "stream_event" && parsed.event) {
			const event = parsed.event as Record<string, unknown>;
			if (
				event.type === "content_block_delta" &&
				(event.delta as Record<string, unknown>)?.type === "text_delta"
			) {
				assistantContentRef.value += (
					event.delta as Record<string, string>
				).text;
				setStreamingContent(assistantContentRef.value);
			}
		}

		// Skip replayed messages
		if (parsed.isReplay) return;

		// Handle assistant messages with tool uses
		if (parsed.type === "assistant" && parsed.message) {
			const message = parsed.message as { content?: unknown[] };
			if (assistantContentRef.value) {
				addEvent({
					type: "assistant",
					id: String(++idCounter),
					content: assistantContentRef.value,
				});
				assistantContentRef.value = "";
				setStreamingContent("");
			}

			if (Array.isArray(message.content)) {
				for (const block of message.content) {
					const b = block as Record<string, unknown>;
					if (b.type === "tool_use") {
						addOrUpdateToolGroup({
							toolUseId: b.id as string,
							name: b.name as string,
							input: (b.input as Record<string, unknown>) || {},
							status: "running",
						});
					}
				}
			}
		}

		// Handle tool results
		if (parsed.type === "user") {
			const message = parsed.message as { content?: unknown[] };
			if (Array.isArray(message?.content)) {
				for (const block of message.content) {
					const b = block as Record<string, unknown>;
					if (b.type === "tool_result" && b.tool_use_id) {
						const resultImages: string[] = [];
						if (Array.isArray(b.content)) {
							for (const resultBlock of b.content) {
								const rb = resultBlock as Record<string, unknown>;
								if (rb.type === "image") {
									const source = rb.source as Record<string, string>;
									if (source?.type === "base64") {
										resultImages.push(
											`data:${source.media_type};base64,${source.data}`,
										);
									}
								}
							}
						}
						updateToolStatus(
							b.tool_use_id as string,
							b.is_error ? "error" : "complete",
							resultImages.length > 0 ? resultImages : undefined,
						);
					}
				}
			}
		}

		// Handle result
		if (parsed.type === "result") {
			if (parsed.session_id) {
				localStorage.setItem("sessionId", parsed.session_id as string);
			}

			if (assistantContentRef.value) {
				addEvent({
					type: "assistant",
					id: String(++idCounter),
					content: assistantContentRef.value,
				});
				assistantContentRef.value = "";
				setStreamingContent("");
			}

			markAllToolsComplete();

			if (parsed.subtype !== "success") {
				const errors = parsed.errors as string[] | undefined;
				const errorMsg = errors?.join(", ") || (parsed.subtype as string);
				addEvent({
					type: "error",
					id: String(++idCounter),
					message: errorMsg,
				});
				notifyClaudeError(errorMsg);
			} else {
				notifyClaudeFinished(assistantContentRef.value);
			}
		}
	};

	// Load assistant session history
	const loadHistory = async (sessionId?: string | null) => {
		const currentProjectPath = projectPath();
		if (!currentProjectPath) return;

		try {
			const storedSessionId = sessionId ?? localStorage.getItem("sessionId");
			if (storedSessionId) {
				const res = await fetch(
					apiUrl(
						`/api/sessions/${encodeURIComponent(storedSessionId)}/history`,
						currentProjectPath,
					),
				);
				const data = await res.json();
				const messages = data.messages?.length ? data.messages : [];
				setEvents(messages);
				setIsCompacted(data.isCompacted || false);
				setSessionName(data.firstPrompt || getSessionNameFromEvents(messages));
				idCounter = messages.length || 0;
			} else {
				const res = await fetch(apiUrl("/api/sessions", currentProjectPath));
				const data = await res.json();

				if (data.latestSessionId) {
					localStorage.setItem("sessionId", data.latestSessionId);
					const historyRes = await fetch(
						apiUrl(
							`/api/sessions/${encodeURIComponent(data.latestSessionId)}/history`,
							currentProjectPath,
						),
					);
					const historyData = await historyRes.json();
					const messages = historyData.messages?.length
						? historyData.messages
						: [];
					setEvents(messages);
					setIsCompacted(historyData.isCompacted || false);
					setSessionName(
						historyData.firstPrompt || getSessionNameFromEvents(messages),
					);
					idCounter = messages.length || 0;
				} else {
					setEvents([]);
					setIsCompacted(false);
					setSessionName("");
					idCounter = 0;
				}
			}

			// Check if backend is busy
			const currentSession = localStorage.getItem("sessionId");
			if (currentSession) {
				const statusRes = await fetch(
					`/api/sessions/${encodeURIComponent(currentSession)}/status`,
				);
				const statusData = await statusRes.json();
				if (statusData.busy) {
					setIsLoading(true);
				}
			}
		} catch (err) {
			console.error("Failed to load history:", err);
			setEvents([]);
			idCounter = 0;
		}
	};

	// Connect to worker stream
	const connectToThreadStream = (workerId: string) => {
		if (threadEventSource) {
			threadEventSource.close();
		}

		setEvents([]);
		setIsLoading(true);
		idCounter = 0;

		const assistantContentRef = { value: "" };
		threadEventSource = new EventSource(`/api/threads/${workerId}/stream`);

		threadEventSource.onmessage = (e) => {
			try {
				const parsed = JSON.parse(e.data);

				// Handle stream completion
				if (parsed.type === "done" || parsed.type === "error") {
					if (assistantContentRef.value) {
						addEvent({
							type: "assistant",
							id: String(++idCounter),
							content: assistantContentRef.value,
						});
						assistantContentRef.value = "";
						setStreamingContent("");
					}
					markAllToolsComplete();
					setIsLoading(false);
					threadEventSource?.close();
					return;
				}

				processStreamEvent(parsed, assistantContentRef);
			} catch {
				// Skip invalid JSON
			}
		};

		threadEventSource.onerror = () => {
			setIsLoading(false);
			threadEventSource?.close();
		};
	};

	// Handle thread selection
	const handleSelectThread = async (thread: Thread) => {
		// Clean up any existing worker connection
		if (threadEventSource) {
			threadEventSource.close();
			threadEventSource = null;
		}

		if (thread.type === "worker") {
			setActiveThread(thread);
			setShowThreadList(false);

			// Show initial task as user message
			setEvents([
				{
					type: "user",
					id: "0",
					content: thread.name,
				},
			]);

			// Connect to worker stream if running
			if (thread.status === "running") {
				connectToThreadStream(thread.id);
			}
		} else {
			// Switch to assistant thread
			setActiveThread(null);
			localStorage.setItem("sessionId", thread.id);
			localStorage.setItem("projectPath", thread.projectPath);
			setProjectPath(thread.projectPath);
			await loadHistory(thread.id);
			setShowThreadList(false);
		}
	};

	// Return to assistant view
	const returnToAssistant = () => {
		if (threadEventSource) {
			threadEventSource.close();
			threadEventSource = null;
		}
		setActiveThread(null);
		loadHistory();
	};

	onMount(async () => {
		let storedProjectPath = localStorage.getItem("projectPath");
		if (!storedProjectPath) {
			const res = await fetch("/api/info");
			const info = await res.json();
			storedProjectPath = info.cwd;
		}
		setProjectPath(storedProjectPath || "");
		if (storedProjectPath) {
			localStorage.setItem("projectPath", storedProjectPath);
		}

		await loadHistory();
		initWebSocket();
	});

	onCleanup(() => {
		if (threadEventSource) {
			threadEventSource.close();
		}
	});

	// Auto-scroll on new content
	createEffect(() => {
		events();
		streamingContent();
		if (mainRef) {
			mainRef.scrollTop = mainRef.scrollHeight;
		}
	});

	// Send message (assistant mode)
	const sendMessage = async (directMessage?: string) => {
		if (isBackgroundThread()) {
			return sendWorkerMessage(directMessage);
		}

		const text = directMessage ?? input().trim();
		const images = attachedImages();
		const currentProjectPath = projectPath();
		if ((!text && images.length === 0) || isLoading() || !currentProjectPath)
			return;

		if (!sessionName() && text) {
			setSessionName(text.length > 50 ? `${text.slice(0, 50)}...` : text);
		}

		addEvent({
			type: "user",
			id: String(++idCounter),
			content: text,
			images: images.length > 0 ? images : undefined,
		});
		if (!directMessage) setInput("");
		setAttachedImages([]);
		setIsLoading(true);
		setStreamingContent("");

		abortController = new AbortController();

		try {
			const sessionId = localStorage.getItem("sessionId") || "new";
			const res = await fetch(
				apiUrl(
					`/api/sessions/${encodeURIComponent(sessionId)}/messages`,
					currentProjectPath,
				),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: text, images }),
					signal: abortController.signal,
				},
			);

			const reader = res.body?.getReader();
			if (!reader) return;

			const decoder = new TextDecoder();
			const assistantContentRef = { value: "" };

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk.split("\n");

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6);
						if (data === "[DONE]") continue;

						try {
							const parsed = JSON.parse(data);
							processStreamEvent(parsed, assistantContentRef);
						} catch {
							// Skip invalid JSON
						}
					}
				}
			}

			if (assistantContentRef.value && streamingContent()) {
				addEvent({
					type: "assistant",
					id: String(++idCounter),
					content: assistantContentRef.value,
				});
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === "AbortError")) {
				addEvent({
					type: "error",
					id: String(++idCounter),
					message: String(err),
				});
			}
		} finally {
			setIsLoading(false);
			setStreamingContent("");
			abortController = null;
		}
	};

	// Send message to worker (inject)
	const sendWorkerMessage = async (directMessage?: string) => {
		const thread = activeThread();
		if (!thread || thread.type !== "worker") return;

		const text = directMessage ?? input().trim();
		if (!text || isLoading()) return;

		if (!directMessage) setInput("");

		try {
			const res = await fetch(`/api/threads/${thread.id}/inject`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: text }),
			});
			const data = await res.json();
			if (data.ok) {
				addEvent({
					type: "user",
					id: String(++idCounter),
					content: text,
				});
			} else {
				alert(data.error || "Failed to send message");
			}
		} catch (err) {
			alert(String(err));
		}
	};

	// Voice status
	const status = (): VoiceStatus => {
		if (isRecording()) return "recording";
		if (isTranscribing()) return "transcribing";
		if (isLoading()) return "thinking";
		if (isPlaying()) return "speaking";
		return "idle";
	};

	const handleMicClick = async () => {
		if (isRecording()) {
			stopRecording(audioRefs, audioState);
		} else if (isLoading()) {
			if (abortController) {
				abortController.abort();
			}
			const sessionId = localStorage.getItem("sessionId");
			if (sessionId) {
				try {
					await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/cancel`, {
						method: "POST",
					});
				} catch {
					// Ignore
				}
			}
			setIsLoading(false);
			setStreamingContent("");
		} else if (isPlaying()) {
			stopPlayback(audioRefs, audioState);
		} else if (!isTranscribing()) {
			startRecording(audioRefs, audioState);
		}
	};

	const handlePlayTTS = (id: string, text: string) => {
		playTTS(id, text, audioRefs, audioState);
	};

	// Auto-send after voice transcription
	createEffect(() => {
		const text = input();
		if (text && pendingVoiceInput() && !isTranscribing() && !isLoading()) {
			setPendingVoiceInput(false);
			setTimeout(() => {
				if (input().trim()) {
					sendMessage();
				}
			}, 100);
		}
	});

	// Close menu when clicking outside
	createEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef && !menuRef.contains(e.target as Node)) {
				setShowMenu(false);
			}
		};

		if (showMenu()) {
			document.addEventListener("click", handleClickOutside);
			return () => document.removeEventListener("click", handleClickOutside);
		}
	});

	const handleCommit = () => {
		setShowDiffModal(false);
		sendMessage("Commit the current changes");
	};

	const handleCompact = async () => {
		setShowMenu(false);
		const sessionId = localStorage.getItem("sessionId");
		const currentProjectPath = projectPath();
		if (!sessionId || !currentProjectPath) {
			alert("No active session to compact");
			return;
		}
		setIsCompacting(true);
		try {
			const res = await fetch(
				apiUrl(
					`/api/sessions/${encodeURIComponent(sessionId)}/compact`,
					currentProjectPath,
				),
				{ method: "POST" },
			);
			const data = await res.json();
			if (data.ok) {
				setEvents([]);
				setIsCompacted(true);
				idCounter = 0;
			} else {
				alert(data.error || "Failed to compact session");
			}
		} catch (err) {
			console.error("Compact failed:", err);
			alert("Failed to compact session");
		} finally {
			setIsCompacting(false);
		}
	};

	const handleClear = async () => {
		setShowMenu(false);
		const sessionId = localStorage.getItem("sessionId");
		const currentProjectPath = projectPath();
		if (!sessionId || !currentProjectPath) {
			alert("No active session to clear");
			return;
		}
		if (!confirm("Delete this thread? This cannot be undone.")) {
			return;
		}
		setIsClearing(true);
		try {
			const res = await fetch(
				apiUrl(
					`/api/sessions/${encodeURIComponent(sessionId)}`,
					currentProjectPath,
				),
				{ method: "DELETE" },
			);
			const data = await res.json();
			if (data.ok) {
				setEvents([]);
				setIsCompacted(false);
				setSessionName("");
				localStorage.removeItem("sessionId");
				idCounter = 0;
			} else {
				alert(data.error || "Failed to delete session");
			}
		} catch (err) {
			console.error("Delete failed:", err);
			alert("Failed to delete session");
		} finally {
			setIsClearing(false);
		}
	};

	const handleStopThread = async () => {
		const thread = activeThread();
		if (thread?.type === "worker") {
			await fetch(`/api/threads/${thread.id}/stop`, { method: "POST" });
			setActiveThread({ ...thread, status: "stopped" });
		}
	};

	// Header display
	const headerTitle = () => {
		const thread = activeThread();
		if (thread) {
			return thread.name.length > 40
				? `${thread.name.slice(0, 40)}...`
				: thread.name;
		}
		return sessionName() || "Assistant";
	};

	const headerSubtitle = () => {
		const thread = activeThread();
		if (thread) {
			const runtime = Math.floor((Date.now() - thread.startTime) / 1000);
			const mins = Math.floor(runtime / 60);
			const timeStr = mins > 0 ? `${mins}m` : `${runtime}s`;
			return `${thread.projectName} · Thread · ${timeStr}`;
		}
		return projectPath();
	};

	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header */}
			<Show when={projectPath()}>
				<header class="flex-none px-4 py-2 border-b border-border z-20 bg-background">
					<div class="max-w-2xl mx-auto flex items-center justify-between">
						<button
							type="button"
							onClick={() =>
								isBackgroundThread()
									? returnToAssistant()
									: setShowThreadList(true)
							}
							class="text-sm hover:text-foreground transition-colors text-left flex-1 overflow-hidden"
						>
							<div class="flex items-center gap-2">
								<Show when={isBackgroundThread()}>
									<svg
										class="w-4 h-4 text-muted-foreground"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M15 19l-7-7 7-7"
										/>
									</svg>
								</Show>
								<span class="text-foreground font-medium truncate">
									{headerTitle()}
								</span>
							</div>
							<div class="text-muted-foreground font-mono text-xs truncate flex items-center gap-1.5">
								<Show when={!isBackgroundThread()}>
									<span
										class={`w-1.5 h-1.5 rounded-full ${
											connectionStatus() === "connected"
												? "bg-green-500"
												: connectionStatus() === "connecting"
													? "bg-yellow-500"
													: "bg-red-500"
										}`}
									/>
								</Show>
								<Show when={isBackgroundThread()}>
									<span
										class={`w-1.5 h-1.5 rounded-full ${
											activeThread()?.status === "running"
												? "bg-green-500 animate-pulse"
												: activeThread()?.status === "completed"
													? "bg-blue-500"
													: activeThread()?.status === "error"
														? "bg-red-500"
														: "bg-muted-foreground"
										}`}
									/>
								</Show>
								{headerSubtitle()}
							</div>
						</button>
						<Show
							when={
								isBackgroundThread() && activeThread()?.status === "running"
							}
						>
							<button
								type="button"
								onClick={handleStopThread}
								class="ml-2 px-3 py-1.5 text-sm rounded-lg bg-red-950 text-red-400"
							>
								Stop
							</button>
						</Show>
					</div>
				</header>
			</Show>

			{/* Scrollable chat history */}
			<main ref={mainRef} class="flex-1 overflow-y-auto p-4">
				<div class="max-w-2xl mx-auto space-y-4 w-full pb-40">
					{/* Compacted context indicator (assistant only) */}
					<Show when={isCompacted() && !isBackgroundThread()}>
						<div class="flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
							<svg
								class="w-4 h-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
								/>
							</svg>
							<span>Previous context has been compacted</span>
						</div>
					</Show>

					<For each={events()}>
						{(event) => (
							<>
								{event.type === "user" && (
									<div class="flex justify-end">
										<div class="px-4 py-2 rounded-xl bg-foreground text-background max-w-[85%]">
											<Show when={event.images?.length}>
												<div class="flex flex-wrap gap-2 mb-2">
													<For each={event.images}>
														{(img) => (
															<img
																src={img}
																alt="Attached"
																class="max-h-48 rounded-lg"
															/>
														)}
													</For>
												</div>
											</Show>
											<Show when={event.content}>{event.content}</Show>
										</div>
									</div>
								)}

								{event.type === "assistant" && (
									<div class="prose prose-sm max-w-none group relative">
										<Markdown content={event.content} />
										<Show when={!isBackgroundThread()}>
											<button
												type="button"
												class="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-background border border-border hover:bg-muted"
												onClick={() => handlePlayTTS(event.id, event.content)}
											>
												<svg
													class="w-4 h-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													{playingId() === event.id ? (
														<rect
															x="6"
															y="6"
															width="12"
															height="12"
															rx="2"
															fill="currentColor"
														/>
													) : (
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.5l5-3.5v14l-5-3.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h2.5z"
														/>
													)}
												</svg>
											</button>
										</Show>
									</div>
								)}

								{event.type === "tools" && (
									<ToolGroup
										tools={event.tools}
										defaultExpanded={event.tools.some(
											(t) => t.status === "running",
										)}
										onOpenFile={(path) => {
											setFileViewerPath(path);
											setShowFileViewer(true);
										}}
									/>
								)}

								{event.type === "error" && (
									<div class="text-sm text-red-500">{event.message}</div>
								)}
							</>
						)}
					</For>

					<Show when={streamingContent()}>
						<div class="prose prose-sm max-w-none">
							<Markdown content={streamingContent()} />
						</div>
					</Show>

					<Show when={isLoading() && !streamingContent()}>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<span class="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
							<span>{isBackgroundThread() ? "Working..." : "Thinking..."}</span>
						</div>
					</Show>

					<Show when={isCompacting()}>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<span class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
							<span>Compacting context...</span>
						</div>
					</Show>
				</div>
			</main>

			{/* Fixed floating bottom controls */}
			<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
				{/* Text input - always show for workers, toggle for assistant */}
				<Show when={showTextInput() || isBackgroundThread()}>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							sendMessage();
						}}
						class="flex gap-2 bg-muted border border-border rounded-full px-3 py-2 shadow-lg"
					>
						<Show when={!isBackgroundThread()}>
							<ImagePickerButton
								images={attachedImages}
								setImages={setAttachedImages}
								disabled={() =>
									isLoading() || isRecording() || isTranscribing()
								}
							/>
						</Show>
						<input
							type="text"
							value={input()}
							onInput={(e) => setInput(e.currentTarget.value)}
							placeholder={
								isBackgroundThread() ? "Send to worker..." : "Type a message..."
							}
							disabled={
								isBackgroundThread()
									? activeThread()?.status !== "running"
									: isLoading() || isRecording() || isTranscribing()
							}
							class="input flex-1 min-w-[200px]"
						/>
						<button
							type="submit"
							disabled={
								!input().trim() ||
								(isBackgroundThread()
									? activeThread()?.status !== "running"
									: isLoading() || isRecording() || isTranscribing())
							}
							class="px-3 py-1.5 rounded-full bg-foreground text-background disabled:opacity-50"
						>
							<svg
								class="w-5 h-5"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
								/>
							</svg>
						</button>
					</form>
				</Show>

				{/* Image preview (assistant only) */}
				<Show when={!isBackgroundThread()}>
					<ImagePreview images={attachedImages} setImages={setAttachedImages} />
				</Show>

				{/* Buttons - full controls for assistant, simplified for worker */}
				<Show when={!isBackgroundThread()}>
					<div class="flex items-center justify-center gap-4 bg-muted rounded-full px-3 py-2 border border-border shadow-lg">
						<OptionsMenuButton
							menuRef={menuRef}
							showMenu={showMenu()}
							setShowMenu={setShowMenu}
						>
							<OptionsMenu
								showTextInput={showTextInput()}
								onToggleTextInput={() => {
									setShowTextInput(!showTextInput());
									setShowMenu(false);
								}}
								onCompact={handleCompact}
								onClear={handleClear}
								isCompacting={isCompacting()}
								isClearing={isClearing()}
								isLoading={isLoading()}
							/>
						</OptionsMenuButton>

						<MicButton
							status={status()}
							audioLevels={audioLevels()}
							disabled={isTranscribing()}
							onClick={handleMicClick}
						/>

						<GitStatusIndicator
							gitStatus={gitStatus()}
							onClick={() => setShowDiffModal(true)}
							onLongPress={() => setShowGitPanel(true)}
						/>
					</div>
				</Show>
			</div>

			{/* Git Diff Modal */}
			<Show when={showDiffModal()}>
				<GitDiffModal
					projectPath={projectPath()}
					onClose={() => setShowDiffModal(false)}
					onCommit={handleCommit}
				/>
			</Show>

			{/* Thread List */}
			<Show when={showThreadList()}>
				<ThreadListPanel
					currentSessionId={localStorage.getItem("sessionId")}
					onSelectThread={handleSelectThread}
					onNewThread={(path) => {
						localStorage.removeItem("sessionId");
						localStorage.setItem("projectPath", path);
						setProjectPath(path);
						setEvents([]);
						setIsCompacted(false);
						setSessionName("");
						setShowThreadList(false);
					}}
					onClose={() => setShowThreadList(false)}
				/>
			</Show>

			{/* File Browser Modal */}
			<Show when={showFileBrowser()}>
				<FileBrowserModal
					projectPath={projectPath()}
					onClose={() => setShowFileBrowser(false)}
					onSelectFile={(path) => {
						setShowFileBrowser(false);
						setFileViewerPath(path);
						setShowFileViewer(true);
					}}
				/>
			</Show>

			{/* File Viewer Modal */}
			<Show when={showFileViewer()}>
				<FileViewerModal
					projectPath={projectPath()}
					filePath={fileViewerPath()}
					onClose={() => setShowFileViewer(false)}
				/>
			</Show>

			{/* Git Panel */}
			<Show when={showGitPanel()}>
				<GitPanel
					projectPath={projectPath()}
					onClose={() => setShowGitPanel(false)}
				/>
			</Show>
		</div>
	);
}
