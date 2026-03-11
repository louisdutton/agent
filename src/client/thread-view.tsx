import {
	createEffect,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { api } from "./api";
import { createEventHandlers, processStreamEvent } from "./events";
import { Markdown } from "./markdown";
import { ToolGroup } from "./tools";
import type { EventItem, Thread } from "./types";
import { parseJSON } from "./util";

type Props = {
	thread: Thread;
	onBack: () => void;
	onOpenFile: (path: string) => void;
};

export function ThreadView(props: Props) {
	const [events, setEvents] = createSignal<EventItem[]>([
		{ type: "user", id: "0", content: props.thread.name },
	]);
	const [isLoading, setIsLoading] = createSignal(true);
	const [streamingContent, setStreamingContent] = createSignal("");
	const [status, setStatus] = createSignal<Thread["status"]>(
		props.thread.status,
	);
	const [input, setInput] = createSignal("");

	let mainRef: HTMLElement | undefined;
	let streamAbort: AbortController | null = null;

	const idCounter = { value: 1 };
	const eventHandlers = createEventHandlers(
		setEvents,
		setStreamingContent,
		() => {}, // Threads don't use approval flow
		() => props.thread.projectPath,
		idCounter,
	);

	const consumeStream = async (stream: AsyncIterable<string>) => {
		setIsLoading(true);
		const assistantContentRef = { value: "" };

		try {
			for await (const chunk of stream) {
				const lines = chunk.split("\n");
				for (const line of lines) {
					const data = line.startsWith("data: ") ? line.slice(6) : line;
					if (!data || data === "[DONE]") continue;

					const [parsed, err] = parseJSON(data);
					if (err) {
						console.warn("Failed to parse stream data:", err);
						continue;
					}

					switch (parsed.type) {
						case "connected":
							// Server tells us the current status on connect
							if (parsed.status) {
								setStatus(parsed.status as Thread["status"]);
							}
							continue;

						case "done":
						case "cancelled":
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
							setStatus("completed");
							return;

						case "error":
							eventHandlers.markAllToolsComplete();
							setStatus("error");
							return;

						case "result":
							processStreamEvent(parsed, assistantContentRef, eventHandlers);
							setStatus(parsed.subtype === "success" ? "completed" : "error");
							break;

						default:
							processStreamEvent(parsed, assistantContentRef, eventHandlers);
					}
				}
			}
		} finally {
			setIsLoading(false);
			streamAbort = null;
		}
	};

	const connectToStream = async () => {
		streamAbort?.abort();
		streamAbort = new AbortController();
		setIsLoading(true);

		const { data, error } = await api
			.threads({ id: props.thread.id })
			.stream.get({
				fetch: { signal: streamAbort.signal },
			});

		if (error || !data || typeof data === "string") {
			console.error("Failed to connect to thread stream:", error);
			setIsLoading(false);
			setStatus("error");
			return;
		}

		await consumeStream(data as AsyncIterable<string>);
	};

	const handleStop = async () => {
		await api.threads({ id: props.thread.id }).stop.post();
		setStatus("stopped");
	};

	const handleSendMessage = async () => {
		const text = input().trim();
		if (!text || status() !== "running") return;

		setInput("");

		const { error } = await api
			.threads({ id: props.thread.id })
			.inject.post({ message: text });

		if (error) {
			alert("Failed to send message");
			return;
		}

		eventHandlers.addEvent({
			type: "user",
			id: eventHandlers.getNextId(),
			content: text,
		});
	};

	onMount(() => {
		// Connect to stream - server sends status in connected event and replays buffered events
		connectToStream();
	});

	onCleanup(() => {
		streamAbort?.abort();
		streamAbort = null;
	});

	// Auto-scroll on content changes
	createEffect(() => {
		events();
		streamingContent();
		if (mainRef) mainRef.scrollTop = mainRef.scrollHeight;
	});

	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header */}
			<header class="flex-none px-4 py-2 border-b border-border z-20 bg-background">
				<div class="max-w-2xl mx-auto flex items-center justify-between">
					<button
						type="button"
						onClick={props.onBack}
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
								{props.thread.name.length > 40
									? `${props.thread.name.slice(0, 40)}...`
									: props.thread.name}
							</span>
						</div>
						<div class="text-muted-foreground font-mono text-xs truncate flex items-center gap-1.5">
							<span
								class={`w-1.5 h-1.5 rounded-full ${
									status() === "running"
										? "bg-green-500 animate-pulse"
										: status() === "completed"
											? "bg-blue-500"
											: status() === "error"
												? "bg-red-500"
												: "bg-muted-foreground"
								}`}
							/>
							{props.thread.projectName}
						</div>
					</button>
					<Show when={status() === "running"}>
						<button
							type="button"
							onClick={handleStop}
							class="ml-2 px-3 py-1.5 text-sm rounded-lg bg-red-950 text-red-400"
						>
							Stop
						</button>
					</Show>
				</div>
			</header>

			{/* Chat content */}
			<main ref={mainRef} class="flex-1 overflow-y-auto p-4">
				<div class="max-w-2xl mx-auto space-y-4 w-full pb-40">
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
										onOpenFile={props.onOpenFile}
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
							<span>Working...</span>
						</div>
					</Show>
				</div>
			</main>

			{/* Input */}
			<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-10">
				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleSendMessage();
					}}
					class="flex gap-2 bg-muted border border-border rounded-full px-3 py-2 shadow-lg"
				>
					<input
						type="text"
						value={input()}
						onInput={(e) => setInput(e.currentTarget.value)}
						placeholder="Send to thread..."
						disabled={status() !== "running"}
						class="input flex-1 min-w-[200px]"
					/>
					<button
						type="submit"
						disabled={!input().trim() || status() !== "running"}
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
			</div>
		</div>
	);
}
