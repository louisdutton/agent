import { createEffect, createSignal, For, onMount, Show } from "solid-js";
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
import { Markdown } from "./markdown";
import {
	MicButton,
	OptionsMenu,
	OptionsMenuButton,
	type VoiceStatus,
} from "./round-buttons";
import { SessionManagerModal } from "./session-manager";
import { ToolGroup } from "./tools";
import type { EventItem, Tool, ToolStatus } from "./types";

export function App() {
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [isRecording, setIsRecording] = createSignal(false);
	const [isTranscribing, setIsTranscribing] = createSignal(false);
	const [pendingVoiceInput, setPendingVoiceInput] = createSignal(false);
	const [playingId, setPlayingId] = createSignal<string | null>(null);
	const [isPlaying, setIsPlaying] = createSignal(false);
	const [showMenu, setShowMenu] = createSignal(false);
	const [showSessionModal, setShowSessionModal] = createSignal(false);
	const [cwd, setCwd] = createSignal("");
	const [isCompacting, setIsCompacting] = createSignal(false);
	const [isClearing, setIsClearing] = createSignal(false);
	const [isCompacted, setIsCompacted] = createSignal(false);
	const [showTextInput, setShowTextInput] = createSignal(false);
	const [sessionName, setSessionName] = createSignal("");
	const [attachedImages, setAttachedImages] = createSignal<string[]>([]);

	// Git state
	const gitStatus = useGitStatus();
	const [showDiffModal, setShowDiffModal] = createSignal(false);
	const [audioLevels, setAudioLevels] = createSignal<number[]>([0, 0, 0, 0]);

	// File viewer state
	const [showFileBrowser, setShowFileBrowser] = createSignal(false);
	const [showFileViewer, setShowFileViewer] = createSignal(false);
	const [fileViewerPath, setFileViewerPath] = createSignal("");

	let mainRef: HTMLElement | undefined;
	let menuRef: HTMLDivElement | undefined;
	let imageInputRef: HTMLInputElement | undefined;
	let idCounter = 0;
	let abortController: AbortController | null = null;

	// Audio refs
	const audioRefs: AudioRefs = createAudioRefs();

	// Audio state for passing to audio functions
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

	// Extract first user message from events as session name
	const getSessionNameFromEvents = (messages: EventItem[]) => {
		const firstUser = messages.find((m) => m.type === "user");
		if (firstUser && firstUser.type === "user") {
			const content = firstUser.content;
			return content.length > 50 ? `${content.slice(0, 50)}...` : content;
		}
		return "";
	};

	// Load chat history and cwd
	const loadHistory = async (sessionId?: string | null) => {
		try {
			const storedSessionId = sessionId ?? localStorage.getItem("sessionId");
			if (storedSessionId) {
				const res = await fetch(
					`/api/session/${encodeURIComponent(storedSessionId)}/history`,
				);
				const data = await res.json();
				const messages = data.messages?.length ? data.messages : [];
				setEvents(messages);
				setCwd(data.cwd || "");
				setIsCompacted(data.isCompacted || false);
				setSessionName(data.firstPrompt || getSessionNameFromEvents(messages));
				idCounter = messages.length || 0;
			} else {
				// No session stored - fetch cwd and check for latest session
				const res = await fetch(`/api/cwd`);
				const data = await res.json();
				setCwd(data.cwd || "");

				// If there's a latest session available, load it
				if (data.latestSessionId) {
					localStorage.setItem("sessionId", data.latestSessionId);
					const historyRes = await fetch(
						`/api/session/${encodeURIComponent(data.latestSessionId)}/history`,
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

			// Check if the backend is busy processing a request for this session
			const currentSessionId = localStorage.getItem("sessionId");
			if (currentSessionId) {
				const statusRes = await fetch(
					`/api/session/${encodeURIComponent(currentSessionId)}/status`,
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

	onMount(() => loadHistory());

	const handleCommit = () => {
		setShowDiffModal(false);
		sendMessage("Commit the current changes");
	};

	createEffect(() => {
		events();
		streamingContent();
		if (mainRef) {
			mainRef.scrollTop = mainRef.scrollHeight;
		}
	});

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

	const updateToolStatus = (toolUseId: string, status: ToolStatus) => {
		setEvents((prev) =>
			prev.map((e) => {
				if (e.type === "tools") {
					return {
						...e,
						tools: e.tools.map((t) =>
							t.toolUseId === toolUseId ? { ...t, status } : t,
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

	// Handle image file selection
	const handleImageSelect = async (e: Event) => {
		const input = e.target as HTMLInputElement;
		const files = input.files;
		if (!files?.length) return;

		const newImages: string[] = [];
		for (const file of files) {
			const reader = new FileReader();
			const base64 = await new Promise<string>((resolve) => {
				reader.onload = () => resolve(reader.result as string);
				reader.readAsDataURL(file);
			});
			newImages.push(base64);
		}
		setAttachedImages((prev) => [...prev, ...newImages]);
		input.value = ""; // Reset input so same file can be selected again
	};

	const removeImage = (index: number) => {
		setAttachedImages((prev) => prev.filter((_, i) => i !== index));
	};

	const sendMessage = async (directMessage?: string) => {
		const text = directMessage ?? input().trim();
		const images = attachedImages();
		if ((!text && images.length === 0) || isLoading()) return;

		// Set session name from first message if not set
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
			const sessionId = localStorage.getItem("sessionId");
			const res = await fetch(`/api/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: text, sessionId, images }),
				signal: abortController.signal,
			});

			const reader = res.body?.getReader();
			if (!reader) return;

			const decoder = new TextDecoder();
			let assistantContent = "";

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

							if (parsed.type === "stream_event" && parsed.event) {
								const event = parsed.event;
								if (
									event.type === "content_block_delta" &&
									event.delta?.type === "text_delta"
								) {
									assistantContent += event.delta.text;
									setStreamingContent(assistantContent);
								}
							}

							// Skip replayed messages - history is loaded from /api/history
							if (parsed.isReplay) continue;

							if (parsed.type === "assistant" && parsed.message?.content) {
								if (assistantContent) {
									addEvent({
										type: "assistant",
										id: String(++idCounter),
										content: assistantContent,
									});
									assistantContent = "";
									setStreamingContent("");
								}

								for (const block of parsed.message.content) {
									if (block.type === "tool_use") {
										addOrUpdateToolGroup({
											toolUseId: block.id,
											name: block.name,
											input: block.input || {},
											status: "running",
										});
									}
								}
							}

							if (parsed.type === "user") {
								const content = parsed.message?.content;
								if (Array.isArray(content)) {
									for (const block of content) {
										if (block.type === "tool_result" && block.tool_use_id) {
											updateToolStatus(
												block.tool_use_id,
												block.is_error ? "error" : "complete",
											);
										}
									}
								}
							}

							if (parsed.type === "result") {
								// Capture session_id from result to persist across refreshes
								if (parsed.session_id) {
									localStorage.setItem("sessionId", parsed.session_id);
								}

								if (assistantContent) {
									addEvent({
										type: "assistant",
										id: String(++idCounter),
										content: assistantContent,
									});
									assistantContent = "";
									setStreamingContent("");
								}

								markAllToolsComplete();

								if (parsed.subtype !== "success") {
									addEvent({
										type: "error",
										id: String(++idCounter),
										message: parsed.errors?.join(", ") || parsed.subtype,
									});
								}
							}
						} catch {
							// Skip invalid JSON
						}
					}
				}
			}

			if (assistantContent && streamingContent()) {
				addEvent({
					type: "assistant",
					id: String(++idCounter),
					content: assistantContent,
				});
			}
		} catch (err) {
			// Don't show error if request was aborted
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

	// Status helpers for mic button
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
			// Cancel the AI response on both frontend and backend
			if (abortController) {
				abortController.abort();
			}
			// Tell the backend to cancel the Claude request
			try {
				await fetch(`/api/cancel`, { method: "POST" });
			} catch {
				// Ignore errors - the request may have already finished
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

	// Auto-send after voice transcription only
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

	const handleCompact = async () => {
		setShowMenu(false);
		const sessionId = localStorage.getItem("sessionId");
		if (!sessionId) {
			alert("No active session to compact");
			return;
		}
		setIsCompacting(true);
		try {
			const res = await fetch(
				`/api/session/${encodeURIComponent(sessionId)}/compact`,
				{
					method: "POST",
				},
			);
			const data = await res.json();
			if (data.ok) {
				// Clear the events and show compacted indicator
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
		if (!sessionId) {
			alert("No active session to clear");
			return;
		}
		if (
			!confirm(
				"Clear the session context? This will reset Claude's memory of this conversation.",
			)
		) {
			return;
		}
		setIsClearing(true);
		try {
			const res = await fetch(
				`/api/session/${encodeURIComponent(sessionId)}/clear`,
				{
					method: "POST",
				},
			);
			const data = await res.json();
			if (data.ok) {
				// Clear the events display
				setEvents([]);
				setIsCompacted(false);
				idCounter = 0;
			} else {
				alert(data.error || "Failed to clear session");
			}
		} catch (err) {
			console.error("Clear failed:", err);
			alert("Failed to clear session");
		} finally {
			setIsClearing(false);
		}
	};

	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header */}
			<Show when={cwd()}>
				<header class="flex-none px-4 py-2 border-b border-border">
					<div class="max-w-2xl mx-auto">
						<button
							type="button"
							onClick={() => setShowSessionModal(true)}
							class="text-sm hover:text-foreground transition-colors text-left w-full overflow-hidden"
						>
							<Show when={sessionName()}>
								<div class="text-foreground font-medium truncate">
									{sessionName()}
								</div>
							</Show>
							<div class="text-muted-foreground font-mono text-xs truncate">
								{cwd()}
							</div>
						</button>
					</div>
				</header>
			</Show>

			{/* Scrollable chat history */}
			<main
				ref={mainRef}
				class="flex-1 min-h-0 overflow-y-auto p-4 border-b border-border"
			>
				<div class="max-w-2xl mx-auto space-y-4 w-full pb-4">
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
									<div class="prose prose-sm max-w-none group relative">
										<Markdown content={event.content} />
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
							<span>Thinking...</span>
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

			{/* Hidden image input */}
			<input
				ref={imageInputRef}
				type="file"
				accept="image/*"
				multiple
				class="hidden"
				onChange={handleImageSelect}
			/>

			{/* Bottom controls */}
			<div class="flex-none flex flex-col items-center pt-2 pb-6 gap-3">
				{/* Image preview */}
				<Show when={attachedImages().length > 0}>
					<div class="w-full max-w-2xl px-4">
						<div class="flex gap-2 flex-wrap">
							<For each={attachedImages()}>
								{(img, index) => (
									<div class="relative">
										<img
											src={img}
											alt="Attached"
											class="h-16 w-16 object-cover rounded-lg border border-border"
										/>
										<button
											type="button"
											onClick={() => removeImage(index())}
											class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
										>
											×
										</button>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>

				{/* Text input */}
				<Show when={showTextInput()}>
					<div class="w-full max-w-2xl px-4">
						<form
							onSubmit={(e) => {
								e.preventDefault();
								sendMessage();
							}}
							class="flex gap-2"
						>
							<button
								type="button"
								onClick={() => imageInputRef?.click()}
								disabled={isLoading() || isRecording() || isTranscribing()}
								class="px-3 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
								title="Attach image"
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
										d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
									/>
								</svg>
							</button>
							<input
								type="text"
								value={input()}
								onInput={(e) => setInput(e.currentTarget.value)}
								placeholder="Type a message..."
								disabled={isLoading() || isRecording() || isTranscribing()}
								class="input flex-1"
							/>
							<button
								type="submit"
								disabled={
									(!input().trim() && attachedImages().length === 0) ||
									isLoading() ||
									isRecording() ||
									isTranscribing()
								}
								class="px-4 py-2 rounded-lg bg-foreground text-background disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
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
					</div>
				</Show>

				<div class="flex items-center justify-center gap-6">
					{/* Options menu button */}
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

					{/* Mic button */}
					<MicButton
						status={status()}
						audioLevels={audioLevels()}
						disabled={isTranscribing()}
						onClick={handleMicClick}
					/>

					{/* Git status button - tap for diff, hold for file browser */}
					<GitStatusIndicator
						gitStatus={gitStatus()}
						onClick={() => setShowDiffModal(true)}
						onLongPress={() => setShowFileBrowser(true)}
					/>
				</div>
			</div>

			{/* Git Diff Modal */}
			<Show when={showDiffModal()}>
				<GitDiffModal
					onClose={() => setShowDiffModal(false)}
					onCommit={handleCommit}
				/>
			</Show>

			{/* Session Manager Modal */}
			<Show when={showSessionModal()}>
				<SessionManagerModal
					onClose={() => setShowSessionModal(false)}
					onSwitch={(messages, sessionId, compacted, firstPrompt, newCwd) => {
						localStorage.setItem("sessionId", sessionId);
						setEvents(messages);
						setIsCompacted(compacted);
						setSessionName(firstPrompt || getSessionNameFromEvents(messages));
						if (newCwd) setCwd(newCwd);
						idCounter = messages.length;
						setShowSessionModal(false);
					}}
					onNewSession={async () => {
						localStorage.removeItem("sessionId");
						setEvents([]);
						setIsCompacted(false);
						setSessionName("");
						idCounter = 0;
						setShowSessionModal(false);
						// Fetch cwd without loading a session
						await loadHistory(null);
					}}
				/>
			</Show>

			{/* File Browser Modal */}
			<Show when={showFileBrowser()}>
				<FileBrowserModal
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
					filePath={fileViewerPath()}
					onClose={() => setShowFileViewer(false)}
				/>
			</Show>
		</div>
	);
}
