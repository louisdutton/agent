// Worker view with event stream
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Markdown } from "./markdown";
import { ToolGroup } from "./tools";
import type { EventItem, Tool, ToolStatus } from "./types";

type WorkerSession = {
	sessionId: string;
	type: "worker";
	status: "idle" | "running" | "error" | "completed" | "stopped";
	projectPath: string;
	pid: number | null;
	startTime: number;
	parentSession: string;
	task: string;
};

export function WorkerView(props: {
	worker: WorkerSession;
	onClose: () => void;
	onStop: () => void;
}) {
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [connected, setConnected] = createSignal(false);
	const [injectInput, setInjectInput] = createSignal("");
	const [injecting, setInjecting] = createSignal(false);

	let idCounter = 0;
	let eventSource: EventSource | null = null;
	let mainRef: HTMLElement | undefined;

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

	onMount(() => {
		// Connect to worker stream
		eventSource = new EventSource(
			`/api/workers/${props.worker.sessionId}/stream`,
		);

		let assistantContent = "";

		eventSource.onopen = () => {
			setConnected(true);
		};

		eventSource.onmessage = (e) => {
			try {
				const parsed = JSON.parse(e.data);

				// Handle stream completion
				if (parsed.type === "done" || parsed.type === "error") {
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
					eventSource?.close();
					setConnected(false);
					return;
				}

				// Handle streaming text
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

				// Handle assistant messages with tool uses
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

				// Handle tool results
				if (parsed.type === "user") {
					const content = parsed.message?.content;
					if (Array.isArray(content)) {
						for (const block of content) {
							if (block.type === "tool_result" && block.tool_use_id) {
								const resultImages: string[] = [];
								if (Array.isArray(block.content)) {
									for (const resultBlock of block.content) {
										if (
											resultBlock.type === "image" &&
											resultBlock.source?.type === "base64"
										) {
											const dataUrl = `data:${resultBlock.source.media_type};base64,${resultBlock.source.data}`;
											resultImages.push(dataUrl);
										}
									}
								}
								updateToolStatus(
									block.tool_use_id,
									block.is_error ? "error" : "complete",
									resultImages.length > 0 ? resultImages : undefined,
								);
							}
						}
					}
				}

				// Handle result
				if (parsed.type === "result") {
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
				}
			} catch {
				// Skip invalid JSON
			}
		};

		eventSource.onerror = () => {
			setConnected(false);
		};
	});

	onCleanup(() => {
		eventSource?.close();
	});

	const handleInject = async () => {
		const message = injectInput().trim();
		if (!message || injecting()) return;

		setInjecting(true);
		try {
			const res = await fetch(`/api/workers/${props.worker.sessionId}/inject`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message }),
			});
			const data = await res.json();
			if (data.ok) {
				// Add user message to events
				addEvent({
					type: "user",
					id: String(++idCounter),
					content: message,
				});
				setInjectInput("");
			} else {
				alert(data.error || "Failed to inject message");
			}
		} catch (err) {
			alert(String(err));
		} finally {
			setInjecting(false);
		}
	};

	const formatRuntime = () => {
		const elapsed = Date.now() - props.worker.startTime;
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	};

	const statusColor = () => {
		switch (props.worker.status) {
			case "running":
				return "bg-green-500";
			case "completed":
				return "bg-blue-500";
			case "error":
				return "bg-red-500";
			case "stopped":
				return "bg-yellow-500";
			default:
				return "bg-muted-foreground";
		}
	};

	return (
		<div class="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header */}
			<header class="flex-none px-4 py-3 border-b border-border">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<button
							type="button"
							onClick={props.onClose}
							class="p-2 -ml-2 rounded-lg hover:bg-muted"
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
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</button>
						<div>
							<div class="flex items-center gap-2">
								<span class={`w-2 h-2 rounded-full ${statusColor()}`} />
								<span class="font-medium truncate max-w-[200px]">
									{props.worker.task.slice(0, 50)}
									{props.worker.task.length > 50 ? "..." : ""}
								</span>
							</div>
							<div class="text-xs text-muted-foreground">
								{formatRuntime()} | {props.worker.projectPath.split("/").pop()}
							</div>
						</div>
					</div>
					<Show when={props.worker.status === "running"}>
						<button
							type="button"
							onClick={props.onStop}
							class="px-3 py-1.5 text-sm rounded-lg bg-red-950 text-red-400 hover:bg-red-900"
						>
							Stop
						</button>
					</Show>
				</div>
			</header>

			{/* Scrollable content */}
			<main ref={mainRef} class="flex-1 overflow-y-auto p-4">
				<div class="max-w-2xl mx-auto space-y-4 w-full pb-24">
					{/* Initial task */}
					<div class="flex justify-end">
						<div class="px-4 py-2 rounded-xl bg-foreground text-background max-w-[85%]">
							{props.worker.task}
						</div>
					</div>

					<For each={events()}>
						{(event) => (
							<>
								{event.type === "user" && (
									<div class="flex justify-end">
										<div class="px-4 py-2 rounded-xl bg-foreground text-background max-w-[85%]">
											{event.content}
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
										onOpenFile={() => {}}
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

					<Show
						when={connected() && !streamingContent() && events().length === 0}
					>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<span class="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
							<span>Worker starting...</span>
						</div>
					</Show>
				</div>
			</main>

			{/* Input for injecting messages */}
			<Show when={props.worker.status === "running"}>
				<div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 pb-6 safe-area-inset-bottom">
					<form
						onSubmit={(e) => {
							e.preventDefault();
							handleInject();
						}}
						class="max-w-2xl mx-auto flex gap-2"
					>
						<input
							type="text"
							value={injectInput()}
							onInput={(e) => setInjectInput(e.currentTarget.value)}
							placeholder="Send message to worker..."
							disabled={injecting()}
							class="flex-1 px-4 py-2 rounded-xl bg-muted border border-border"
						/>
						<button
							type="submit"
							disabled={!injectInput().trim() || injecting()}
							class="px-4 py-2 rounded-xl bg-foreground text-background disabled:opacity-50"
						>
							Send
						</button>
					</form>
				</div>
			</Show>
		</div>
	);
}
