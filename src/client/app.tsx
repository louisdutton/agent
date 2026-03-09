import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { api } from "./api";
import {
	type AudioRefs,
	createAudioRefs,
	playTTS,
	startRecording,
	stopPlayback,
	stopRecording,
} from "./audio";
import {
	createEventHandlers,
	getSessionNameFromEvents,
	processStreamEvent,
} from "./events";
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
import {
	MicButton,
	OptionsMenu,
	OptionsMenuButton,
	ThreadsButton,
	type VoiceStatus,
} from "./round-buttons";
import { navigate, useLocation, type ViewType } from "./router";
import { ThreadListPanel } from "./thread-list";
import { ToolGroup } from "./tools";
import type { EventItem, Thread } from "./types";
import { initWebSocket } from "./ws";

export function App() {
	// URL-based routing state (single source of truth)
	const location = useLocation();
	const [defaultProject, setDefaultProject] = createSignal("");

	// Unified view derivation from URL (only URL params, not defaultProject)
	const view = (): ViewType => {
		const loc = location();
		// If URL has task, we're viewing a task
		if (loc.taskId) {
			return { type: "task", taskId: loc.taskId };
		}
		// If URL has project (with or without session), we're in a session
		if (loc.project) {
			return {
				type: "session",
				project: loc.project,
				sessionId: loc.sessionId,
			};
		}
		return { type: "home" };
	};

	// Convenience accessors - not in home view
	const isInThread = () => view().type !== "home";
	const sessionId = () => {
		const v = view();
		return v.type === "session" ? v.sessionId : null;
	};
	// projectPath falls back to defaultProject for API calls
	const projectPath = () => {
		const v = view();
		return v.type === "session" ? v.project : defaultProject();
	};

	// Core state
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [sessionName, setSessionName] = createSignal("");
	const [isCompacted, setIsCompacted] = createSignal(false);

	// Task state (for background threads)
	const [activeTask, setActiveTask] = createSignal<Thread | null>(null);
	const [showThreadList, setShowThreadList] = createSignal(false);

	// UI state
	const [showMenu, setShowMenu] = createSignal(false);
	const [showTextInput, setShowTextInput] = createSignal(false);
	const [isCompacting, setIsCompacting] = createSignal(false);
	const [isClearing] = createSignal(false);
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
	let abortController: AbortController | null = null;

	const idCounter = { value: 0 };
	const eventHandlers = createEventHandlers(
		setEvents,
		setStreamingContent,
		projectPath,
		idCounter,
	);

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
	const isBackgroundThread = () => activeTask() !== null;

	// Load session history from API
	const loadHistory = async (sid: string, project: string) => {
		try {
			const { data } = await api.sessions({ sessionId: sid }).history.get({
				query: { project },
			});
			const messages = data?.messages?.length ? data.messages : [];
			setEvents(messages);
			setIsCompacted(data?.isCompacted || false);
			setSessionName(data?.firstPrompt || getSessionNameFromEvents(messages));
			idCounter.value = messages.length || 0;

			// Check if backend is busy - if so, connect to stream
			const { data: statusData } = await api
				.sessions({ sessionId: sid })
				.status.get();
			if (statusData?.busy) {
				connectToSessionStream(sid);
			}
		} catch (err) {
			console.error("Failed to load history:", err);
			setEvents([]);
			idCounter.value = 0;
		}
	};

	// Stream abort controller for cancellation
	let streamAbort: AbortController | null = null;

	// Core stream consumption with reconnection support
	const consumeStream = async (
		stream: AsyncIterable<string>,
		options: { clearEvents?: boolean } = {},
	) => {
		if (options.clearEvents) {
			setEvents([]);
			idCounter.value = 0;
		}
		setIsLoading(true);

		const assistantContentRef = { value: "" };

		try {
			for await (const chunk of stream) {
				// Parse SSE data format: "data: {...}\n\n"
				const lines = chunk.split("\n");
				for (const line of lines) {
					const data = line.startsWith("data: ") ? line.slice(6) : line;
					if (!data || data === "[DONE]") continue;

					try {
						const parsed = JSON.parse(data);

						if (parsed.type === "connected") {
							continue;
						}

						if (
							parsed.type === "done" ||
							parsed.type === "error" ||
							parsed.type === "cancelled"
						) {
							if (assistantContentRef.value) {
								eventHandlers.addEvent({
									type: "assistant",
									id: eventHandlers.getNextId(),
									content: assistantContentRef.value,
								});
								assistantContentRef.value = "";
								setStreamingContent("");
							}
							eventHandlers.markAllToolsComplete();
							return;
						}

						processStreamEvent(parsed, assistantContentRef, eventHandlers);
					} catch {
						// Skip invalid JSON
					}
				}
			}
		} finally {
			setIsLoading(false);
			streamAbort = null;
		}
	};

	// Connect to a session stream (for reconnecting to busy sessions)
	const connectToSessionStream = async (sessionId: string) => {
		streamAbort?.abort();
		streamAbort = new AbortController();

		const { data, error } = await api.sessions({ sessionId }).stream.get({
			fetch: { signal: streamAbort.signal },
		});

		if (error || !data || typeof data === "string") {
			console.error("Failed to connect to session stream:", error);
			setIsLoading(false);
			return;
		}

		await consumeStream(data as AsyncIterable<string>);
	};

	// Connect to a thread stream (with event replay)
	const connectToThreadStream = async (threadId: string) => {
		streamAbort?.abort();
		streamAbort = new AbortController();

		const { data, error } = await api.threads({ id: threadId }).stream.get({
			fetch: { signal: streamAbort.signal },
		});

		if (error || !data || typeof data === "string") {
			console.error("Failed to connect to thread stream:", error);
			setIsLoading(false);
			return;
		}

		await consumeStream(data as AsyncIterable<string>, { clearEvents: true });
	};

	// Handle thread selection from thread list
	const handleSelectThread = async (thread: Thread) => {
		// Clean up any existing stream connection
		streamAbort?.abort();

		setShowThreadList(false);

		if (thread.type === "thread") {
			// Background threads are transient - store in state, not URL
			setActiveTask(thread);
			setEvents([
				{
					type: "user",
					id: "0",
					content: thread.name,
				},
			]);

			// Always connect to stream - it will replay buffered events
			connectToThreadStream(thread.id);
			navigate({ type: "task", taskId: thread.id });
		} else {
			// Session threads - navigate via URL (this triggers the effect below)
			setActiveTask(null);
			navigate({
				type: "session",
				project: thread.projectPath,
				sessionId: thread.id,
			});
		}
	};

	// Return to main view (thread list)
	const returnToMain = () => {
		streamAbort?.abort();
		setActiveTask(null);
		setEvents([]);
		setSessionName("");
		setIsCompacted(false);
		navigate({ type: "home" });
	};

	// Reactive effect: when URL changes, load the appropriate session
	createEffect(() => {
		const sid = sessionId();
		const project = projectPath();

		if (sid && project && !activeTask()) {
			loadHistory(sid, project);
		} else if (!sid && !activeTask()) {
			// No session in URL and not viewing a thread - clear state
			setEvents([]);
			setSessionName("");
			setIsCompacted(false);
			idCounter.value = 0;
		}
	});

	onMount(async () => {
		// Get default project path for when URL has no project
		const { data } = await api.info.get();
		setDefaultProject(data?.cwd || "");

		initWebSocket();
	});

	onCleanup(() => {
		streamAbort?.abort();
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
			return sendThreadMessage(directMessage);
		}

		const text = directMessage ?? input().trim();
		const images = attachedImages();
		const currentProjectPath = projectPath();
		if ((!text && images.length === 0) || isLoading() || !currentProjectPath)
			return;

		if (!sessionName() && text) {
			setSessionName(text.length > 50 ? `${text.slice(0, 50)}...` : text);
		}

		eventHandlers.addEvent({
			type: "user",
			id: eventHandlers.getNextId(),
			content: text,
			images: images.length > 0 ? images : undefined,
		});
		if (!directMessage) setInput("");
		setAttachedImages([]);
		setIsLoading(true);
		setStreamingContent("");

		abortController = new AbortController();

		try {
			const currentSessionId = sessionId() || "new";
			const { data, error } = await api
				.sessions({ sessionId: currentSessionId })
				.messages.post(
					{ message: text, images },
					{
						query: { project: currentProjectPath },
						fetch: { signal: abortController.signal },
					},
				);

			if (error || !data || typeof data === "string") {
				throw new Error("Failed to send message");
			}

			await consumeStream(data as AsyncIterable<string>);
		} catch (err) {
			if (!(err instanceof DOMException && err.name === "AbortError")) {
				eventHandlers.addEvent({
					type: "error",
					id: eventHandlers.getNextId(),
					message: String(err),
				});
			}
		} finally {
			abortController = null;
		}
	};

	// Send message to thread (inject)
	const sendThreadMessage = async (directMessage?: string) => {
		const thread = activeTask();
		if (!thread || thread.type !== "thread") return;

		const text = directMessage ?? input().trim();
		if (!text || isLoading()) return;

		if (!directMessage) setInput("");

		const { data, error } = await api
			.threads({ id: thread.id })
			.inject.post({ message: text });

		if (error || !data?.ok) {
			alert(error?.value || "Failed to send message");
			return;
		}

		eventHandlers.addEvent({
			type: "user",
			id: eventHandlers.getNextId(),
			content: text,
		});
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
			const currentSessionId = sessionId();
			if (currentSessionId) {
				try {
					await api.sessions({ sessionId: currentSessionId }).cancel.post();
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

	const handleCommit = async () => {
		setShowDiffModal(false);
		const currentProjectPath = projectPath();
		if (!currentProjectPath) return;

		const { data, error } = await api.git.commit.post(
			{},
			{ query: { project: currentProjectPath } },
		);
		if (error || !data?.ok) {
			alert(error?.value || "Commit failed");
		}
		// Git status will refresh on next poll
	};

	const handleCompact = async () => {
		setShowMenu(false);
		const currentSessionId = sessionId();
		const currentProjectPath = projectPath();
		if (!currentSessionId || !currentProjectPath) {
			alert("No active session to compact");
			return;
		}
		setIsCompacting(true);

		const { data, error } = await api
			.sessions({ sessionId: currentSessionId })
			.compact.post({}, { query: { project: currentProjectPath } });

		setIsCompacting(false);

		if (error || !data?.ok) {
			alert(error?.value || "Failed to compact session");
			return;
		}

		setEvents([]);
		setIsCompacted(true);
		idCounter.value = 0;
	};

	const handleClear = () => {
		setShowMenu(false);
		// Clear UI and start fresh session (no session ID = new session on next message)
		setEvents([]);
		setStreamingContent("");
		setSessionName("");
		setIsCompacted(false);
		const project = projectPath() || defaultProject();
		navigate({ type: "session", project });
	};

	const handleStopThread = async () => {
		const thread = activeTask();
		if (thread?.type === "thread") {
			await api.threads({ id: thread.id }).stop.post();
			setActiveTask({ ...thread, status: "stopped" });
		}
	};

	// Header display
	const headerTitle = () => {
		const thread = activeTask();
		if (thread) {
			return thread.name.length > 40
				? `${thread.name.slice(0, 40)}...`
				: thread.name;
		}
		// For session threads, use sessionName
		const name = sessionName();
		if (name) {
			return name.length > 40 ? `${name.slice(0, 40)}...` : name;
		}
		return "Thread";
	};

	const headerSubtitle = () => {
		const thread = activeTask();
		if (thread) {
			return thread.projectName;
		}
		// For session threads, extract project name from path
		const project = projectPath();
		return project ? project.split("/").pop() : null;
	};

	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header - shown when in a thread (URL has session) or viewing a thread */}
			<Show when={isInThread() || isBackgroundThread()}>
				<header class="flex-none px-4 py-2 border-b border-border z-20 bg-background">
					<div class="max-w-2xl mx-auto flex items-center justify-between">
						<button
							type="button"
							onClick={returnToMain}
							class="text-sm hover:text-foreground transition-colors text-left flex-1 overflow-hidden"
						>
							<div class="flex items-center gap-2">
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
								<span class="text-foreground font-medium truncate">
									{headerTitle()}
								</span>
							</div>
							<div class="text-muted-foreground font-mono text-xs truncate flex items-center gap-1.5">
								<Show when={isBackgroundThread()}>
									<span
										class={`w-1.5 h-1.5 rounded-full ${
											activeTask()?.status === "running"
												? "bg-green-500 animate-pulse"
												: activeTask()?.status === "completed"
													? "bg-blue-500"
													: activeTask()?.status === "error"
														? "bg-red-500"
														: "bg-muted-foreground"
										}`}
									/>
								</Show>
								{headerSubtitle()}
							</div>
						</button>
						<Show
							when={isBackgroundThread() && activeTask()?.status === "running"}
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
				{/* Text input - always show for threads, toggle for assistant */}
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
								isBackgroundThread() ? "Send to thread..." : "Type a message..."
							}
							disabled={
								isBackgroundThread()
									? activeTask()?.status !== "running"
									: isLoading() || isRecording() || isTranscribing()
							}
							class="input flex-1 min-w-[200px]"
						/>
						<button
							type="submit"
							disabled={
								!input().trim() ||
								(isBackgroundThread()
									? activeTask()?.status !== "running"
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

				{/* Buttons - full controls for assistant, simplified for thread */}
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
								onBrowseFiles={() => {
									setShowFileBrowser(true);
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

						{/* Threads button (main view) or Git indicator (in thread) */}
						<Show
							when={isInThread()}
							fallback={
								<ThreadsButton onClick={() => setShowThreadList(true)} />
							}
						>
							<GitStatusIndicator
								gitStatus={gitStatus()}
								onClick={() => setShowDiffModal(true)}
								onLongPress={() => setShowGitPanel(true)}
							/>
						</Show>
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
					currentSessionId={sessionId()}
					onSelectThread={handleSelectThread}
					onNewThread={(path) => {
						// Navigate to new thread (no session yet, just project in URL)
						setShowThreadList(false);
						navigate({ type: "session", project: path });
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
