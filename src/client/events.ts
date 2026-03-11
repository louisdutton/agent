// Event handling and stream processing utilities
import type { Setter } from "solid-js";
import { notifyClaudeError, notifyClaudeFinished } from "./notifications";
import { navigate } from "./router";
import type { EventItem, Tool, ToolStatus } from "./types";

export type ApprovalRequest = {
	id: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	description: string;
};

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
	setPendingApproval: Setter<ApprovalRequest | null>;
	projectPath: () => string;
	getNextId: () => string;
};

export function createEventHandlers(
	setEvents: Setter<EventItem[]>,
	setStreamingContent: Setter<string>,
	setPendingApproval: Setter<ApprovalRequest | null>,
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
		setPendingApproval,
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

// Process streaming WireEvents from provider-agnostic agent
// Also handles legacy thread format for backwards compatibility
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
		setPendingApproval,
		projectPath,
		getNextId,
	} = handlers;

	switch (parsed.type) {
		// === New WireEvent format ===

		// Streaming text
		case "text":
			assistantContentRef.value += parsed.text as string;
			setStreamingContent(assistantContentRef.value);
			break;

		// Text complete - finalize assistant message
		case "text_done":
			if (assistantContentRef.value) {
				addEvent({
					type: "assistant",
					id: getNextId(),
					content: assistantContentRef.value,
				});
				assistantContentRef.value = "";
				setStreamingContent("");
			}
			break;

		// Tool use complete - add to tool group
		case "tool_use_end":
			addOrUpdateToolGroup({
				toolUseId: parsed.id as string,
				name: parsed.name as string,
				input: (parsed.input as Record<string, unknown>) || {},
				status: "running",
			});
			break;

		// Tool result - update tool status
		case "tool_result":
			updateToolStatus(
				parsed.toolCallId as string,
				parsed.isError ? "error" : "complete",
			);
			break;

		// New session created - navigate to it
		case "session_created":
			navigate({
				type: "session",
				project: projectPath(),
				sessionId: parsed.sessionId as string,
			});
			break;

		// Turn complete
		case "turn_end":
		case "done": // Legacy thread format
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
			notifyClaudeFinished(assistantContentRef.value);
			break;

		// Error
		case "error":
			markAllToolsComplete();
			if (parsed.error) {
				addEvent({
					type: "error",
					id: getNextId(),
					message: parsed.error as string,
				});
				notifyClaudeError(parsed.error as string);
			}
			break;

		// Approval needed - tool requires user confirmation
		case "approval_needed":
			setPendingApproval(parsed.request as ApprovalRequest);
			break;

		// === Legacy thread format (Claude CLI output) ===

		// Legacy streaming text
		case "stream_event": {
			const event = parsed.event as Record<string, unknown>;
			if (
				event?.type === "content_block_delta" &&
				(event.delta as Record<string, unknown>)?.type === "text_delta"
			) {
				assistantContentRef.value += (
					event.delta as Record<string, string>
				).text;
				setStreamingContent(assistantContentRef.value);
			}
			break;
		}

		// Legacy assistant message with tool uses
		case "assistant": {
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
			if (Array.isArray(message?.content)) {
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
			break;
		}

		// Legacy tool results
		case "user": {
			const message = parsed.message as { content?: unknown[] };
			if (Array.isArray(message?.content)) {
				for (const block of message.content) {
					const b = block as Record<string, unknown>;
					if (b.type === "tool_result" && b.tool_use_id) {
						updateToolStatus(
							b.tool_use_id as string,
							b.is_error ? "error" : "complete",
						);
					}
				}
			}
			break;
		}

		// Legacy result (session complete)
		case "result":
			if (parsed.session_id) {
				navigate({
					type: "session",
					project: projectPath(),
					sessionId: parsed.session_id as string,
				});
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
				addEvent({ type: "error", id: getNextId(), message: errorMsg });
				notifyClaudeError(errorMsg);
			} else {
				notifyClaudeFinished(assistantContentRef.value);
			}
			break;
	}
}
