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
		async function* ({ params, query, body }) {
			const sessionId = params.sessionId === "new" ? null : params.sessionId;
			try {
				for await (const line of sendMessage(
					body.message,
					sessionId,
					query.project,
					body.images,
				)) {
					yield `data: ${line}\n\n`;
				}
				yield "data: [DONE]\n\n";
			} catch (err) {
				yield `data: {"error": "${String(err)}"}\n\n`;
			}
		},
		{
			query: projectQuery,
			body: t.Object({
				message: t.String(),
				images: t.Optional(t.Array(t.String())),
			}),
		},
	);
