import { createSignal, For, Show } from "solid-js";
import Markdown from "./Markdown";

const API_URL = `http://${window.location.hostname}:3001`;

let msgId = 0;

interface Message {
	id: string;
	role: "user" | "assistant";
	content: string;
}

export default function App() {
	const [messages, setMessages] = createSignal<Message[]>([]);
	const [input, setInput] = createSignal("");
	const [isLoading, setIsLoading] = createSignal(false);
	const [streamingContent, setStreamingContent] = createSignal("");

	const sendMessage = async () => {
		const text = input().trim();
		if (!text || isLoading()) return;

		const userMessage: Message = {
			id: String(++msgId),
			role: "user",
			content: text,
		};

		setMessages([...messages(), userMessage]);
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

							// Handle final result
							if (parsed.type === "result" && parsed.result) {
								assistantContent = parsed.result;
							}
						} catch {
							// Skip invalid JSON
						}
					}
				}
			}

			// Add assistant message
			if (assistantContent) {
				const assistantMessage: Message = {
					id: String(++msgId),
					role: "assistant",
					content: assistantContent,
				};
				setMessages([...messages(), assistantMessage]);
			}
		} catch (err) {
			console.error("Failed to send message:", err);
		} finally {
			setIsLoading(false);
			setStreamingContent("");
		}
	};

	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header */}
			<header class="flex items-center justify-center px-4 py-3 border-b border-border">
				<span class="text-sm font-medium">Claude</span>
			</header>

			{/* Messages */}
			<main class="flex-1 overflow-y-auto p-3 space-y-3">
				<For each={messages()}>
					{(message) => (
						<div class={message.role === "user" ? "ml-8" : "mr-4"}>
							{message.role === "assistant" ? (
								<Markdown content={message.content} />
							) : (
								<div class="card text-sm">{message.content}</div>
							)}
						</div>
					)}
				</For>

				<Show when={streamingContent()}>
					<div class="mr-4">
						<Markdown content={streamingContent()} />
					</div>
				</Show>

				<Show when={isLoading() && !streamingContent()}>
					<div class="text-muted-foreground text-sm">...</div>
				</Show>
			</main>

			{/* Input */}
			<div class="p-3 border-t border-border">
				<form
					class="flex gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						sendMessage();
					}}
				>
					<input
						type="text"
						class="input flex-1 text-sm"
						placeholder="Message..."
						value={input()}
						onInput={(e) => setInput(e.currentTarget.value)}
						disabled={isLoading()}
					/>
					<button
						type="submit"
						class="btn px-3"
						disabled={!input().trim() || isLoading()}
					>
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
								d="M5 12h14M12 5l7 7-7 7"
							/>
						</svg>
					</button>
				</form>
			</div>
		</div>
	);
}
