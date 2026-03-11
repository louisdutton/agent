// Session routes - uses new agent module with direct API and persistence

import { Elysia, t } from "elysia";
import { getSessionManager } from "../agent";
import { subscriptionToGenerator } from "../util";
import type { WireEvent } from "../wire/types";

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

export const sessionsRoutes = new Elysia({ prefix: "/sessions" })
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
			const messages = history.messages.map((msg, i) => {
				if (msg.role === "user") {
					const content =
						typeof msg.content === "string"
							? msg.content
							: msg.content
									.filter((p) => p.type === "text")
									.map((p) => (p as { text: string }).text)
									.join("");
					return { type: "user" as const, id: String(i), content };
				}
				const content =
					typeof msg.content === "string"
						? msg.content
						: msg.content
								.filter((p) => p.type === "text")
								.map((p) => (p as { text: string }).text)
								.join("");
				return { type: "assistant" as const, id: String(i), content };
			});

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
		const session = getSessionManager().get(params.sessionId);
		if (
			!session ||
			session.status === "idle" ||
			session.status === "completed"
		) {
			set.status = 404;
			yield `data: ${JSON.stringify({ type: "error", error: "Session not active" })}\n\n`;
			return;
		}

		yield `data: ${JSON.stringify({ type: "connected", sessionId: params.sessionId })}\n\n`;

		for await (const event of sessionEvents(params.sessionId)) {
			yield `data: ${JSON.stringify(event)}\n\n`;
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

	// Compact session (not yet implemented)
	.post(
		"/:sessionId/compact",
		async () => {
			// TODO: Implement context compaction
			return { ok: true };
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
		async function* ({ params, query, body }) {
			const manager = getSessionManager();
			let sessionId = params.sessionId;
			let session = sessionId === "new" ? null : manager.get(sessionId);

			// Create new session if needed
			if (!session) {
				session = manager.create(query.project);
				sessionId = session.id;
				yield `data: ${JSON.stringify({ type: "session_created", sessionId })}\n\n`;
			}

			// Subscribe to events before sending (to not miss any)
			const events = sessionEvents(sessionId);

			// Send message (runs agent loop in background)
			try {
				await manager.sendMessage(sessionId, body.message, body.images);
			} catch (err) {
				yield `data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`;
				return;
			}

			// Stream events
			for await (const event of events) {
				yield `data: ${JSON.stringify(event)}\n\n`;
			}

			yield "data: [DONE]\n\n";
		},
		{
			query: projectQuery,
			body: t.Object({
				message: t.String(),
				images: t.Optional(t.Array(t.String())),
			}),
		},
	);
