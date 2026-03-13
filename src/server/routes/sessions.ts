// Session routes - uses new agent module with direct API and persistence

import { Elysia, t } from "elysia";
import { getSessionManager } from "../agent/session-manager";
import { subscriptionToGenerator } from "../util";
import type { NotificationEvent, WireEvent } from "../wire/types";

const projectQuery = t.Object({ project: t.String() });

// Convert subscription to async generator for SSE streaming
const sessionEvents = (sessionId: string) =>
	subscriptionToGenerator<WireEvent>(
		(cb) => getSessionManager().subscribeToSession(sessionId, cb),
		(e) =>
			e.type === "turn_end" ||
			e.type === "error" ||
			(e.type === "status" &&
				(e.status === "completed" || e.status === "error")),
	);

// Notification events generator (never terminates - client disconnects)
async function* notificationEvents(): AsyncGenerator<NotificationEvent> {
	const queue: NotificationEvent[] = [];
	let resolve: (() => void) | null = null;

	const unsubscribe = getSessionManager().subscribeToNotifications((event) => {
		queue.push(event);
		resolve?.();
	});

	try {
		while (true) {
			if (queue.length > 0) {
				const item = queue.shift();
				if (item !== undefined) yield item;
			} else {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	} finally {
		unsubscribe();
	}
}

export const sessionsRoutes = new Elysia({ prefix: "/sessions" })
	// Global notifications stream (SSE)
	.get("/notifications", async function* ({ set }) {
		set.headers["content-type"] = "text/event-stream";
		yield JSON.stringify({ type: "connected" });

		for await (const event of notificationEvents()) {
			yield JSON.stringify(event);
		}
	})

	// List sessions from disk
	.get(
		"/",
		async ({ query }) => {
			const manager = getSessionManager();
			const sessions = await manager.listFromDisk(query.project);

			return {
				sessions: sessions.map((s) => ({
					sessionId: s.sessionId,
					firstPrompt: s.title,
					created: new Date(s.createdAt).toISOString(),
					modified: new Date(s.updatedAt).toISOString(),
				})),
				projectPath: query.project,
				latestSessionId: sessions[0]?.sessionId,
			};
		},
		{ query: projectQuery },
	)

	// Get session history
	.get(
		"/:sessionId/history",
		async ({ params, query }) => {
			const manager = getSessionManager();
			const history = await manager.getHistory(query.project, params.sessionId);

			if (!history) {
				return { messages: [], isCompacted: false, firstPrompt: null };
			}

			// Convert provider messages to UI format
			type UIMessage =
				| { type: "user"; id: string; content: string }
				| { type: "assistant"; id: string; content: string }
				| {
						type: "tools";
						id: string;
						tools: Array<{
							toolUseId: string;
							name: string;
							input: Record<string, unknown>;
							status: "complete";
						}>;
				  };

			const messages: UIMessage[] = [];
			let msgIndex = 0;

			for (const msg of history.messages) {
				if (msg.role === "user") {
					// Skip tool_result messages (they're system-generated responses to tool_use)
					if (
						Array.isArray(msg.content) &&
						msg.content.every((p) => p.type === "tool_result")
					) {
						continue;
					}
					const content =
						typeof msg.content === "string"
							? msg.content
							: msg.content
									.filter((p) => p.type === "text")
									.map((p) => (p as { text: string }).text)
									.join("");
					// Only add if there's actual content
					if (content) {
						messages.push({ type: "user", id: String(msgIndex++), content });
					}
				} else {
					// Assistant message - extract text and tool_use blocks
					if (typeof msg.content === "string") {
						messages.push({
							type: "assistant",
							id: String(msgIndex++),
							content: msg.content,
						});
					} else {
						// Get text content
						const textContent = msg.content
							.filter((p) => p.type === "text")
							.map((p) => (p as { text: string }).text)
							.join("");

						if (textContent) {
							messages.push({
								type: "assistant",
								id: String(msgIndex++),
								content: textContent,
							});
						}

						// Get tool_use blocks
						const toolUses = msg.content.filter(
							(p) => p.type === "tool_use",
						) as Array<{
							type: "tool_use";
							id: string;
							name: string;
							input: Record<string, unknown>;
						}>;

						if (toolUses.length > 0) {
							messages.push({
								type: "tools",
								id: String(msgIndex++),
								tools: toolUses.map((t) => ({
									toolUseId: t.id,
									name: t.name,
									input: t.input,
									status: "complete" as const,
								})),
							});
						}
					}
				}
			}

			return {
				messages,
				isCompacted: false,
				firstPrompt: history.title,
			};
		},
		{ query: projectQuery },
	)

	// Check if session is active
	.get("/:sessionId/status", ({ params }) => {
		const session = getSessionManager().get(params.sessionId);
		return {
			busy: session?.status === "running" || session?.status === "waiting",
		};
	})

	// Stream events for reconnecting to active sessions
	.get("/:sessionId/stream", async function* ({ params, set }) {
		set.headers["content-type"] = "text/event-stream";
		const session = getSessionManager().get(params.sessionId);
		if (
			!session ||
			session.status === "idle" ||
			session.status === "completed"
		) {
			set.status = 404;
			yield JSON.stringify({ type: "error", error: "Session not active" });
			return;
		}

		yield JSON.stringify({ type: "connected", sessionId: params.sessionId });

		for await (const event of sessionEvents(params.sessionId)) {
			yield JSON.stringify(event);
		}
	})

	// Delete session
	.delete(
		"/:sessionId",
		async ({ params, query }) => {
			await getSessionManager().delete(params.sessionId, query.project);
			return { ok: true };
		},
		{ query: projectQuery },
	)

	// Compact session context
	.post(
		"/:sessionId/compact",
		async ({ params }) => {
			return await getSessionManager().compact(params.sessionId);
		},
		{ query: projectQuery },
	)

	// Cancel running session
	.post("/:sessionId/cancel", ({ params }) => ({
		cancelled: getSessionManager().cancel(params.sessionId),
	}))

	// Respond to approval request
	.post(
		"/:sessionId/approval",
		({ params, body }) => {
			getSessionManager().respondToApproval(params.sessionId, body.approved);
			return { ok: true };
		},
		{
			body: t.Object({ approved: t.Boolean() }),
		},
	)

	// Send message to session (creates new session if needed)
	.post(
		"/:sessionId/messages",
		async function* ({ params, query, body, set }) {
			set.headers["content-type"] = "text/event-stream";
			const manager = getSessionManager();
			let sessionId = params.sessionId;
			let session = sessionId === "new" ? null : manager.get(sessionId);

			// Create new session if needed
			if (!session) {
				session = manager.create(query.project);
				sessionId = session.id;
				yield JSON.stringify({ type: "session_created", sessionId });
			}

			// Subscribe to events before sending (to not miss any)
			const events = sessionEvents(sessionId);

			// Send message (runs agent loop in background)
			try {
				await manager.sendMessage(sessionId, body.message, body.images);
			} catch (err) {
				yield JSON.stringify({ type: "error", error: String(err) });
				return;
			}

			// Stream events
			for await (const event of events) {
				yield JSON.stringify(event);
			}

			yield "[DONE]";
		},
		{
			query: projectQuery,
			body: t.Object({
				message: t.String(),
				images: t.Optional(t.Array(t.String())),
			}),
		},
	);
