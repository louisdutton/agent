import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import Markdown from "./Markdown";

const API_URL = `http://${window.location.hostname}:3001`;

type ToolStatus = "running" | "complete" | "error";

type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolStatus;
};

type EventItem =
	| { type: "user"; id: string; content: string }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] }
	| { type: "system"; id: string; subtype: string; info: string }
	| {
			type: "result";
			id: string;
			cost: number;
			turns: number;
			duration: number;
	  }
	| { type: "error"; id: string; message: string };

function getToolSummary(name: string, input: Record<string, unknown>): string {
	switch (name) {
		case "Read":
			return String(input.file_path || "")
				.split("/")
				.slice(-2)
				.join("/");
		case "Edit":
		case "Write":
			return String(input.file_path || "")
				.split("/")
				.slice(-2)
				.join("/");
		case "Bash": {
			const cmd = String(input.command || "");
			return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
		}
		case "Glob":
			return String(input.pattern || "");
		case "Grep":
			return `${input.pattern || ""} ${input.path ? "in " + String(input.path).split("/").pop() : ""}`;
		case "Task":
			return String(input.description || input.prompt || "").slice(0, 40);
		case "WebFetch":
			return String(input.url || "")
				.replace(/^https?:\/\//, "")
				.slice(0, 40);
		case "WebSearch":
			return String(input.query || "");
		default:
			if (input.file_path)
				return String(input.file_path).split("/").pop() || "";
			if (input.path) return String(input.path).split("/").pop() || "";
			if (input.command) return String(input.command).slice(0, 30);
			if (input.query) return String(input.query).slice(0, 30);
			return "";
	}
}

function ToolGroup(props: { tools: Tool[]; defaultExpanded?: boolean }) {
	const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

	const allComplete = createMemo(() =>
		props.tools.every((t) => t.status === "complete"),
	);
	const hasError = createMemo(() =>
		props.tools.some((t) => t.status === "error"),
	);
	const runningCount = createMemo(
		() => props.tools.filter((t) => t.status === "running").length,
	);

	return (
		<div class="text-sm">
			<button
				type="button"
				class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
				onClick={() => setExpanded(!expanded())}
			>
				<span
					class={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
						hasError()
							? "bg-red-500"
							: allComplete()
								? "bg-green-500"
								: "bg-yellow-500"
					}`}
				/>
				<span>
					{runningCount() > 0
						? `Running ${runningCount()} action${runningCount() > 1 ? "s" : ""}...`
						: `${props.tools.length} action${props.tools.length > 1 ? "s" : ""}`}
				</span>
				<svg
					class={`w-3 h-3 transition-transform ${expanded() ? "rotate-180" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>

			<Show when={expanded()}>
				<div class="ml-4 mt-1 space-y-1 border-l border-border pl-3">
					<For each={props.tools}>
						{(tool) => (
							<div class="flex items-start gap-2">
								<span
									class={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
										tool.status === "running"
											? "bg-yellow-500"
											: tool.status === "error"
												? "bg-red-500"
												: "bg-green-500"
									}`}
								/>
								<div class="min-w-0 flex-1">
									<span class="font-mono text-muted-foreground">
										{tool.name}
									</span>
									<span class="text-muted-foreground opacity-60 ml-2 break-all">
										{getToolSummary(tool.name, tool.input)}
									</span>
								</div>
							</div>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export default function App() {
	const [events, setEvents] = createSignal<EventItem[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");

	let mainRef: HTMLElement | undefined;
	let idCounter = 0;

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
				// Add to existing tool group
				return [
					...prev.slice(0, -1),
					{ ...last, tools: [...last.tools, tool] },
				];
			}
			// Create new tool group
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

	const sendMessage = async () => {
		const text = input().trim();
		if (!text || isLoading()) return;

		addEvent({ type: "user", id: String(++idCounter), content: text });
		setInput("");
		setIsLoading(true);
		setStreamingContent("");

		try {
			const res = await fetch(`${API_URL}/messages`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: text }),
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

							// Handle streaming text deltas
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

							// Handle assistant message with tool uses
							if (parsed.type === "assistant" && parsed.message?.content) {
								// Flush streaming content first
								if (assistantContent) {
									addEvent({
										type: "assistant",
										id: String(++idCounter),
										content: assistantContent,
									});
									assistantContent = "";
									setStreamingContent("");
								}

								// Only process tool_use blocks, skip text blocks (already streamed)
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

							// Handle user message (tool results)
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

							// Handle system messages
							if (parsed.type === "system" && parsed.subtype === "init") {
								addEvent({
									type: "system",
									id: String(++idCounter),
									subtype: parsed.subtype,
									info: parsed.model,
								});
							}

							// Handle final result
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

								if (parsed.subtype === "success") {
									addEvent({
										type: "result",
										id: String(++idCounter),
										cost: parsed.total_cost_usd,
										turns: parsed.num_turns,
										duration: parsed.duration_ms,
									});
								} else {
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
			addEvent({
				type: "error",
				id: String(++idCounter),
				message: String(err),
			});
		} finally {
			setIsLoading(false);
			setStreamingContent("");
		}
	};

	return (
		<div class="h-dvh flex flex-col bg-background">
			<main ref={mainRef} class="flex-1 overflow-y-auto p-4 mask-fade">
				<div class="max-w-2xl mx-auto space-y-3 w-full py-12">
					<For each={events()}>
						{(event) => (
							<>
								{event.type === "user" && (
									<div class="flex justify-end">
										<div class="p-3 rounded-lg bg-foreground text-background w-fit max-w-[80%]">
											{event.content}
										</div>
									</div>
								)}

								{event.type === "assistant" && (
									<div>
										<Markdown content={event.content} />
									</div>
								)}

								{event.type === "tools" && (
									<ToolGroup
										tools={event.tools}
										defaultExpanded={event.tools.some(
											(t) => t.status === "running",
										)}
									/>
								)}

								{event.type === "system" && (
									<div class="text-xs text-muted-foreground opacity-50">
										{event.info}
									</div>
								)}

								{event.type === "result" && (
									<div class="text-xs text-muted-foreground opacity-40 flex gap-3 pt-2">
										<span>${event.cost.toFixed(4)}</span>
										<span>{event.turns} turns</span>
										<span>{(event.duration / 1000).toFixed(1)}s</span>
									</div>
								)}

								{event.type === "error" && (
									<div class="text-sm text-red-500">{event.message}</div>
								)}
							</>
						)}
					</For>

					<Show when={streamingContent()}>
						<div>
							<Markdown content={streamingContent()} />
						</div>
					</Show>

					<Show when={isLoading() && !streamingContent()}>
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<span class="inline-block w-2 h-2 rounded-full bg-yellow-500" />
							<span>Thinking...</span>
						</div>
					</Show>
				</div>
			</main>

			<form
				class="max-w-2xl mx-auto flex gap-2 w-full py-4 px-2"
				onSubmit={(e) => {
					e.preventDefault();
					sendMessage();
				}}
			>
				<input
					type="text"
					class="input flex-1"
					placeholder="Message..."
					value={input()}
					onInput={(e) => setInput(e.currentTarget.value)}
					disabled={isLoading()}
				/>
				<button
					type="submit"
					class="btn px-4"
					disabled={!input().trim() || isLoading()}
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
							d="M5 12h14M12 5l7 7-7 7"
						/>
					</svg>
				</button>
			</form>
		</div>
	);
}
