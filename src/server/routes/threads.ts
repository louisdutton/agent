import { Elysia, t } from "elysia";
import {
	getAllWorkers,
	injectMessage,
	isWorkerRunning,
	spawnWorker,
	stopWorker,
	subscribeToWorker,
} from "../session";

type WorkerEvent = { type: string; [key: string]: unknown };

/** Convert callback-based subscription to async generator */
async function* workerEvents(workerId: string): AsyncGenerator<WorkerEvent> {
	const queue: WorkerEvent[] = [];
	let resolve: (() => void) | null = null;
	let done = false;

	const unsubscribe = subscribeToWorker(workerId, (event) => {
		queue.push(event);
		if (event.type === "done" || event.type === "error") {
			done = true;
		}
		resolve?.();
	});

	try {
		while (!done || queue.length > 0) {
			if (queue.length > 0) {
				yield queue.shift()!;
			} else {
				await new Promise<void>((r) => (resolve = r));
			}
		}
	} finally {
		unsubscribe();
	}
}

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

	.get("/:id/stream", async function* ({ params, error }) {
		if (!isWorkerRunning(params.id)) {
			return error(404, { error: "Thread not found" });
		}

		for await (const event of workerEvents(params.id)) {
			yield `data: ${JSON.stringify(event)}\n\n`;
		}
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
