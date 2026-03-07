// Event handling and stream processing utilities
import type { Setter } from "solid-js";
import { notifyClaudeError, notifyClaudeFinished } from "./notifications";
import { navigate } from "./router";
import type { EventItem, Tool, ToolStatus } from "./types";

export type EventHandlers = {
	addEvent: (event: EventItem) => void;
	addOrUpdateToolGroup: (tool: Tool) => void;
	updateToolStatus: (
		toolUseId: string,
		status: ToolStatus,
		resultImages?: string[],
	) => void;
	markAllToolsComplete: () => void;
	setStreamingContent: Setter<string>;
	projectPath: () => string;
	getNextId: () => string;
};

export function createEventHandlers(
	setEvents: Setter<EventItem[]>,
	setStreamingContent: Setter<string>,
	projectPath: () => string,
	idCounter: { value: number },
): EventHandlers {
	const getNextId = () => String(++idCounter.value);

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
			return [...prev, { type: "tools", id: getNextId(), tools: [tool] }];
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

	return {
		addEvent,
		addOrUpdateToolGroup,
		updateToolStatus,
		markAllToolsComplete,
		setStreamingContent,
		projectPath,
		getNextId,
	};
}

export function getSessionNameFromEvents(messages: EventItem[]): string {
	const firstUser = messages.find((m) => m.type === "user");
	if (firstUser && firstUser.type === "user") {
		const content = firstUser.content;
		return content.length > 50 ? `${content.slice(0, 50)}...` : content;
	}
	return "";
}

// Process streaming data (shared format for both assistant and worker)
export function processStreamEvent(
	parsed: Record<string, unknown>,
	assistantContentRef: { value: string },
	handlers: EventHandlers,
) {
	const {
		addEvent,
		addOrUpdateToolGroup,
		updateToolStatus,
		markAllToolsComplete,
		setStreamingContent,
		projectPath,
		getNextId,
	} = handlers;

	// Handle streaming text
	if (parsed.type === "stream_event" && parsed.event) {
		const event = parsed.event as Record<string, unknown>;
		if (
			event.type === "content_block_delta" &&
			(event.delta as Record<string, unknown>)?.type === "text_delta"
		) {
			assistantContentRef.value += (event.delta as Record<string, string>).text;
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
				id: getNextId(),
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

	// Handle result - update URL with new session ID
	if (parsed.type === "result") {
		if (parsed.session_id) {
			navigate(parsed.session_id as string, projectPath());
		}

		if (assistantContentRef.value) {
			addEvent({
				type: "assistant",
				id: getNextId(),
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
				id: getNextId(),
				message: errorMsg,
			});
			notifyClaudeError(errorMsg);
		} else {
			notifyClaudeFinished(assistantContentRef.value);
		}
	}
}
