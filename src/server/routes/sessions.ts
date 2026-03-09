import { Elysia, t } from "elysia";
import { compactSession, sendMessage } from "../claude";
import {
	cancelSession,
	clearSessionById,
	getSessionHistoryById,
	getSessionsFromTranscripts,
	isSessionActive,
} from "../session";

const projectQuery = t.Object({ project: t.String() });

export const sessionsRoutes = new Elysia({ prefix: "/sessions" })
	.get(
		"/",
		async ({ query }) => {
			const allSessions = await getSessionsFromTranscripts(query.project);
			const sorted = allSessions
				.filter((e) => !e.isSidechain)
				.sort(
					(a, b) =>
						new Date(b.modified).getTime() - new Date(a.modified).getTime(),
				);

			return {
				sessions: sorted.map((e) => ({
					sessionId: e.sessionId,
					firstPrompt: e.firstPrompt || "Untitled session",
					created: e.created,
					modified: e.modified,
					gitBranch: e.gitBranch,
				})),
				projectPath: query.project,
				latestSessionId: sorted[0]?.sessionId,
			};
		},
		{ query: projectQuery },
	)

	.get(
		"/:sessionId/history",
		async ({ params, query }) => {
			const { messages, isCompacted, firstPrompt } =
				await getSessionHistoryById(params.sessionId, query.project);
			return { messages, isCompacted, firstPrompt };
		},
		{ query: projectQuery },
	)

	.get("/:sessionId/status", ({ params }) => ({
		busy: isSessionActive(params.sessionId),
	}))

	.delete(
		"/:sessionId",
		async ({ params, query }) => {
			await clearSessionById(params.sessionId, query.project);
			return { ok: true };
		},
		{ query: projectQuery },
	)

	.post(
		"/:sessionId/compact",
		async ({ params, query }) => {
			const result = await compactSession(params.sessionId, query.project);
			if (!result.success) {
				return { ok: false, error: result.error };
			}
			return { ok: true };
		},
		{ query: projectQuery },
	)

	.post("/:sessionId/cancel", ({ params }) => ({
		cancelled: cancelSession(params.sessionId),
	}))

	.post(
		"/:sessionId/messages",
		async ({ params, query, body }) => {
			const encoder = new TextEncoder();
			let controllerClosed = false;

			const stream = new ReadableStream({
				async start(controller) {
					try {
						const resolvedSessionId =
							params.sessionId === "new" ? null : params.sessionId;
						for await (const line of sendMessage(
							body.message,
							resolvedSessionId,
							query.project,
							body.images,
						)) {
							if (controllerClosed) break;
							controller.enqueue(encoder.encode(`data: ${line}\n\n`));
						}
						if (!controllerClosed) {
							controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						}
					} catch (err) {
						if (!controllerClosed) {
							try {
								controller.enqueue(
									encoder.encode(`data: {"error": "${String(err)}"}\n\n`),
								);
							} catch {
								// Controller already closed
							}
						}
					} finally {
						if (!controllerClosed) {
							controllerClosed = true;
							controller.close();
						}
					}
				},
				cancel() {
					controllerClosed = true;
				},
			});

			return new Response(stream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
				},
			});
		},
		{
			query: projectQuery,
			body: t.Object({
				message: t.String(),
				images: t.Optional(t.Array(t.String())),
			}),
		},
	);
