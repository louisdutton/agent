import {
	createEffect,
	createSignal,
	For,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { api } from "./api";
import {
	type AudioRefs,
	createAudioRefs,
	startRecording,
	stopRecording,
} from "./audio";
import { Drawer, HamburgerButton } from "./drawer";
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
import { HistoryPage } from "./pages/history";
import { SchedulesPage } from "./pages/schedules";
import { SettingsPage } from "./pages/settings";
import { TasksPage } from "./pages/tasks";
import { WebhooksPage } from "./pages/webhooks";
import {
	MicButton,
	OptionsMenu,
	OptionsMenuButton,
	type VoiceStatus,
} from "./round-buttons";
import { navigate, useLocation, type ViewType } from "./router";
import {
	type ActiveSession,
	addApprovalToQueue,
	type QueuedApproval,
	removeApprovalFromQueue,
	updateActiveSession,
} from "./session-state";
import { SessionStatusBar } from "./session-status-bar";
import { ToolGroup } from "./tools";
import type { BackgroundTask, EventItem } from "./types";
import { initWebSocket, subscribeToNotifications } from "./ws";

export function App() {
	// URL-based routing state (single source of truth)
	const location = useLocation();
	const [defaultProject, setDefaultProject] = createSignal("");

	// Drawer state
	const [drawerOpen, setDrawerOpen] = createSignal(false);

	// Unified view derivation from URL
	const view = (): ViewType => {
		const loc = location();
		// Check for page param first
		if (loc.page) {
			switch (loc.page) {
				case "schedules":
					return { type: "schedules" };
				case "webhooks":
					return { type: "webhooks" };
				case "history":
					return { type: "history" };
				case "tasks":
					return { type: "tasks" };
				case "settings":
					return { type: "settings" };
			}
		}
		// If URL has task, we're viewing a task
		if (loc.taskId) {
			return { type: "task", taskId: loc.taskId };
		}
		// If URL has project (with or without session), we're in a chat
		if (loc.project) {
			return {
				type: "chat",
				project: loc.project,
				sessionId: loc.sessionId,
			};
		}
		return { type: "home" };
	};

	// Convenience accessors - in chat view
	const isInChat = () => {
		const v = view();
		return v.type === "chat" || v.type === "task";
	};
	const sessionId = () => {
		const v = view();
		return v.type === "chat" ? v.sessionId : null;
	};
	// projectPath falls back to defaultProject for API calls
	const projectPath = () => {
		const v = view();
		return v.type === "chat" ? v.project : defaultProject();
	};

	// Core state
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [sessionName, setSessionName] = createSignal("");
	const [isCompacted, setIsCompacted] = createSignal(false);
	const [pendingApproval, setPendingApproval] = createSignal<{
		id: string;
		toolCallId: string;
		toolName: string;
		input: unknown;
		description: string;
	} | null>(null);

	// Task state (for background tasks)
	const [activeTask, setActiveTask] = createSignal<BackgroundTask | null>(null);

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
		setPendingApproval,
		projectPath,
		idCounter,
	);

	const audioRefs: AudioRefs = createAudioRefs();
	const audioState = {
		isRecording,
		setIsRecording,
		isTranscribing,
		setIsTranscribing,
		audioLevels,
		setAudioLevels,
		pendingVoiceInput,
		setPendingVoiceInput,
		setInput,
	};

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
	// Eden parses SSE and yields objects like { data: {...} }
	type SSEChunk = { data?: Record<string, unknown> | string };
	const consumeStream = async (
		stream: AsyncIterable<SSEChunk>,
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
				// Eden returns { data: {...} } for SSE events (already parsed)
				if (!chunk.data || chunk.data === "[DONE]") continue;
				const parsed = chunk.data as Record<string, unknown>;

				// Skip connection confirmation
				if (parsed.type === "connected") continue;

				// Process event (handles text, tools, turn_end, error, etc.)
				processStreamEvent(parsed, assistantContentRef, eventHandlers);

				// Terminal events - stop consuming
				// (turn_end = new WireEvent format, done = legacy thread format)
				if (
					parsed.type === "turn_end" ||
					parsed.type === "error" ||
					parsed.type === "done"
				) {
					return;
				}
			}
		} finally {
			setIsLoading(false);
			streamAbort = null;
		}
	};

	// Connect to a session stream (for reconnecting to busy sessions)
	const connectToSessionStream = async (sessionId: string) => {
		// Don't connect if already streaming (e.g., from sendMessage)
		if (isLoading()) return;

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

		await consumeStream(data as AsyncIterable<SSEChunk>);
	};

	// Handle session selection from status bar
	const handleSelectSession = (session: ActiveSession) => {
		navigate({
			type: "chat",
			project: session.projectPath,
			sessionId: session.id,
		});
	};

	// Handle approval from status bar (for other sessions)
	const handleStatusBarApproval = async (
		approval: QueuedApproval,
		approved: boolean,
	) => {
		removeApprovalFromQueue(approval.request.id);
		try {
			await api
				.sessions({ sessionId: approval.sessionId })
				.approval.post({ approved });
		} catch (err) {
			console.error("Failed to send approval:", err);
		}
	};

	// Return to main view (task list)
	const returnToMain = () => {
		setActiveTask(null);
		setEvents([]);
		setSessionName("");
		setIsCompacted(false);
		navigate({ type: "home" });
	};

	// Reactive effect: clean up stream state when navigating away
	createEffect(
		on(
			view,
			(_currentView, prevView) => {
				// Only clean up if we're leaving a chat context
				if (
					prevView &&
					(prevView.type === "chat" || prevView.type === "task")
				) {
					streamAbort?.abort();
					streamAbort = null;
					setIsLoading(false);
					setStreamingContent("");
				}
			},
			{ defer: true },
		),
	);

	// Reactive effect: when URL changes, load the appropriate session
	createEffect(() => {
		const sid = sessionId();
		const project = projectPath();

		if (sid && project && !activeTask()) {
			loadHistory(sid, project);
		} else if (!sid && !activeTask()) {
			// No session in URL and not viewing a task - clear state
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

		// Subscribe to session notifications
		const unsubscribe = subscribeToNotifications((event) => {
			if (event.type === "session_status") {
				updateActiveSession(
					event.sessionId,
					event.projectPath,
					event.status,
					event.title,
				);
			} else if (event.type === "approval_needed") {
				// Add to queue if not current session
				if (event.sessionId !== sessionId()) {
					addApprovalToQueue(event.sessionId, event.projectPath, event.request);
				}
			}
		});

		onCleanup(unsubscribe);
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

			await consumeStream(data as AsyncIterable<SSEChunk>);
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

	// Voice status
	const status = (): VoiceStatus => {
		if (isRecording()) return "recording";
		if (isTranscribing()) return "transcribing";
		if (isLoading()) return "thinking";
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
		} else if (!isTranscribing()) {
			startRecording(audioRefs, audioState);
		}
	};

	// Handle tool approval/rejection
	const handleApproval = async (approved: boolean) => {
		const currentSessionId = sessionId();
		if (!currentSessionId) return;

		setPendingApproval(null);

		try {
			await api.sessions({ sessionId: currentSessionId }).approval.post({
				approved,
			});
		} catch (err) {
			console.error("Failed to send approval:", err);
		}
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
		navigate({ type: "chat", project });
	};

	// Header display
	const headerTitle = () => {
		const task = activeTask();
		if (task) {
			return task.name.length > 40 ? `${task.name.slice(0, 40)}...` : task.name;
		}
		// For sessions, use sessionName
		const name = sessionName();
		if (name) {
			return name.length > 40 ? `${name.slice(0, 40)}...` : name;
		}
		return "Task";
	};

	const headerSubtitle = () => {
		const task = activeTask();
		if (task) {
			return task.projectName;
		}
		// For sessions, extract project name from path
		const project = projectPath();
		return project ? project.split("/").pop() : null;
	};

	const openDrawer = () => setDrawerOpen(true);
	const closeDrawer = () => setDrawerOpen(false);

	// Render page based on view type (reactive)
	return (
		<>
			<Show when={view().type === "schedules"}>
				<SchedulesPage
					defaultProject={defaultProject()}
					onMenuClick={openDrawer}
				/>
			</Show>

			<Show when={view().type === "webhooks"}>
				<WebhooksPage
					defaultProject={defaultProject()}
					onMenuClick={openDrawer}
				/>
			</Show>

			<Show when={view().type === "history"}>
				<HistoryPage
					defaultProject={defaultProject()}
					onMenuClick={openDrawer}
				/>
			</Show>

			<Show when={view().type === "tasks"}>
				<TasksPage currentSessionId={sessionId()} onMenuClick={openDrawer} />
			</Show>

			<Show when={view().type === "settings"}>
				<SettingsPage onMenuClick={openDrawer} />
			</Show>

			<Show
				when={
					view().type === "home" ||
					view().type === "chat" ||
					view().type === "task"
				}
			>
				<div class="h-dvh flex flex-col bg-background">
					{/* Session status bar - shows other active sessions */}
					<SessionStatusBar
						currentSessionId={sessionId()}
						onSelectSession={handleSelectSession}
						onApprove={handleStatusBarApproval}
					/>

					{/* Header - shown when in a chat */}
					<Show when={isInChat()}>
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
									<div class="text-muted-foreground font-mono text-xs truncate">
										{headerSubtitle()}
									</div>
								</button>
							</div>
						</header>
					</Show>

					{/* Home header with hamburger */}
					<Show when={!isInChat()}>
						<header class="flex-none px-4 py-2 border-b border-border z-20 bg-background">
							<div class="max-w-2xl mx-auto flex items-center gap-2">
								<HamburgerButton onClick={openDrawer} />
								<span class="text-foreground font-medium">Chat</span>
							</div>
						</header>
					</Show>

					{/* Scrollable chat history */}
					<main ref={mainRef} class="flex-1 overflow-y-auto p-4">
						<div class="max-w-2xl mx-auto space-y-4 w-full pb-40">
							{/* Compacted context indicator */}
							<Show when={isCompacted()}>
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
											<div class="prose prose-sm max-w-none">
												<Markdown content={event.content} />
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

										{event.type === "task_spawn" && (
											<button
												type="button"
												onClick={() =>
													navigate({
														type: "chat",
														project: event.task.projectPath || projectPath(),
														sessionId: event.task.taskId,
													})
												}
												class="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-colors w-full text-left"
											>
												<div class="flex-none">
													{event.task.status === "running" && (
														<span class="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
													)}
													{event.task.status === "completed" && (
														<svg
															class="w-4 h-4 text-green-500"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M5 13l4 4L19 7"
															/>
														</svg>
													)}
													{event.task.status === "error" && (
														<svg
															class="w-4 h-4 text-red-500"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																stroke-linecap="round"
																stroke-linejoin="round"
																stroke-width="2"
																d="M6 18L18 6M6 6l12 12"
															/>
														</svg>
													)}
													{event.task.status === "pending" && (
														<span class="inline-block w-2 h-2 rounded-full bg-gray-400" />
													)}
												</div>
												<div class="flex-1 min-w-0">
													<div class="text-sm font-medium truncate">
														{event.task.prompt.length > 60
															? `${event.task.prompt.slice(0, 60)}...`
															: event.task.prompt}
													</div>
													<div class="text-xs text-muted-foreground">
														Task {event.task.status}
													</div>
												</div>
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
														d="M9 5l7 7-7 7"
													/>
												</svg>
											</button>
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
									<span>{"Thinking..."}</span>
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
						{/* Approval UI */}
						<Show when={pendingApproval()}>
							{(approval) => (
								<div class="bg-muted border border-border rounded-xl px-4 py-3 shadow-lg max-w-md">
									<div class="text-sm font-medium mb-2 flex items-center gap-2">
										<svg
											class="w-4 h-4 text-yellow-500"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
											/>
										</svg>
										<span>Approve {approval().toolName}?</span>
									</div>
									<div class="text-xs text-muted-foreground mb-3 font-mono bg-background rounded p-2 max-h-32 overflow-auto">
										{JSON.stringify(approval().input, null, 2)}
									</div>
									<div class="flex gap-2 justify-end">
										<button
											type="button"
											onClick={() => handleApproval(false)}
											class="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-background transition-colors"
										>
											Reject
										</button>
										<button
											type="button"
											onClick={() => handleApproval(true)}
											class="px-3 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
										>
											Approve
										</button>
									</div>
								</div>
							)}
						</Show>

						{/* Text input */}
						<Show when={showTextInput() && !pendingApproval()}>
							<form
								onSubmit={(e) => {
									e.preventDefault();
									sendMessage();
								}}
								class="flex gap-2 bg-muted border border-border rounded-full px-3 py-2 shadow-lg"
							>
								<ImagePickerButton
									images={attachedImages}
									setImages={setAttachedImages}
									disabled={() =>
										isLoading() || isRecording() || isTranscribing()
									}
								/>
								<input
									type="text"
									value={input()}
									onInput={(e) => setInput(e.currentTarget.value)}
									placeholder="Type a message..."
									disabled={isLoading() || isRecording() || isTranscribing()}
									class="input flex-1 min-w-[200px]"
								/>
								<button
									type="submit"
									disabled={
										!input().trim() ||
										isLoading() ||
										isRecording() ||
										isTranscribing()
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

						{/* Image preview */}
						<ImagePreview
							images={attachedImages}
							setImages={setAttachedImages}
						/>

						{/* Bottom controls */}
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

							{/* Git indicator (only in chat) */}
							<Show when={isInChat()}>
								<GitStatusIndicator
									gitStatus={gitStatus()}
									onClick={() => setShowDiffModal(true)}
									onLongPress={() => setShowGitPanel(true)}
								/>
							</Show>
						</div>
					</div>
					<Show when={showDiffModal()}>
						<GitDiffModal
							projectPath={projectPath()}
							onClose={() => setShowDiffModal(false)}
							onCommit={handleCommit}
						/>
					</Show>
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
					<Show when={showFileViewer()}>
						<FileViewerModal
							projectPath={projectPath()}
							filePath={fileViewerPath()}
							onClose={() => setShowFileViewer(false)}
						/>
					</Show>
					<Show when={showGitPanel()}>
						<GitPanel
							projectPath={projectPath()}
							onClose={() => setShowGitPanel(false)}
						/>
					</Show>
				</div>
			</Show>

			<Drawer open={drawerOpen()} onClose={closeDrawer} />
		</>
	);
}
