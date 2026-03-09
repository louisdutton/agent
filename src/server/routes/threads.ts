import { Elysia, t } from "elysia";
import {
	getAllThreads,
	getThreadStatus,
	injectThreadMessage,
	spawnThread,
	stopThread,
	subscribeToThread,
	type ThreadEvent,
	threadExists,
} from "../session";
import { subscriptionToGenerator } from "../util";

const threadEvents = (threadId: string) =>
	subscriptionToGenerator<ThreadEvent>(
		(cb, opts) => subscribeToThread(threadId, cb, opts),
		(e) => e.type === "done" || e.type === "error",
	);

export const threadsRoutes = new Elysia({ prefix: "/threads" })
	.get("/", () => {
		const threads = getAllThreads();
		return { threads };
	})

	.post(
		"/spawn",
		async ({ body }) => {
			const result = await spawnThread(
				body.projectPath,
				body.task,
				body.parentSession,
			);
			if (result.error) {
				return { error: result.error };
			}
			return { session: result.session };
		},
		{
			body: t.Object({
				projectPath: t.String(),
				task: t.String(),
				parentSession: t.String(),
			}),
		},
	)

	.post("/:id/stop", ({ params }) => {
		const stopped = stopThread(params.id);
		return { stopped };
	})

	.get("/:id/status", ({ params }) => {
		const status = getThreadStatus(params.id);
		if (!status) {
			return { exists: false, status: null };
		}
		return { exists: true, status };
	})

	.get("/:id/stream", async function* ({ params, status }) {
		if (!threadExists(params.id)) {
			return status(404, "Thread not found");
		}

		yield `data: ${JSON.stringify({ type: "connected", threadId: params.id })}\n\n`;

		for await (const event of threadEvents(params.id)) {
			yield `data: ${JSON.stringify(event)}\n\n`;
		}
	})

	.post(
		"/:id/inject",
		async ({ params, body }) => {
			const result = await injectThreadMessage(params.id, body.message);
			if (!result.success) {
				return { error: result.error };
			}
			return { ok: true };
		},
		{ body: t.Object({ message: t.String() }) },
	);
