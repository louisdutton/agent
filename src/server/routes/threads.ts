import { Elysia, t } from "elysia";
import {
	getAllWorkers,
	injectMessage,
	isWorkerRunning,
	spawnWorker,
	stopWorker,
	subscribeToWorker,
} from "../session";

export const threadsRoutes = new Elysia({ prefix: "/threads" })
	.get("/", () => {
		const threads = getAllWorkers();
		return { threads };
	})

	.post(
		"/spawn",
		async ({ body }) => {
			const result = await spawnWorker(
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
		const stopped = stopWorker(params.id);
		return { stopped };
	})

	.get("/:id/stream", ({ params }) => {
		if (!isWorkerRunning(params.id)) {
			return new Response(JSON.stringify({ error: "Thread not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		}

		const encoder = new TextEncoder();
		let unsubscribe: () => void;

		const stream = new ReadableStream({
			start(controller) {
				unsubscribe = subscribeToWorker(params.id, (event) => {
					if (event.type === "done" || event.type === "error") {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
						);
						controller.close();
					} else {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
						);
					}
				});
			},
			cancel() {
				if (unsubscribe) unsubscribe();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			},
		});
	})

	.post(
		"/:id/inject",
		async ({ params, body }) => {
			const result = await injectMessage(params.id, body.message);
			if (!result.success) {
				return { error: result.error };
			}
			return { ok: true };
		},
		{ body: t.Object({ message: t.String() }) },
	);
