// Automation routes - cron jobs and webhooks

import { Elysia, t } from "elysia";
import { describeCron, getNextRun } from "../scheduler/cron";
import {
	createJob,
	createWebhook,
	deleteJob,
	deleteWebhook,
	getHistory,
	getHistoryForAutomation,
	getJob,
	getWebhook,
	getWebhookBySecret,
	listJobs,
	listWebhooks,
	runJobNow,
	triggerWebhook,
	updateJob,
	updateWebhook,
} from "../scheduler/scheduler";

const cronJobSchema = t.Object({
	name: t.String(),
	schedule: t.String(),
	prompt: t.String(),
	project: t.String(),
	enabled: t.Boolean(),
});

const webhookSchema = t.Object({
	name: t.String(),
	prompt: t.String(),
	project: t.String(),
	enabled: t.Boolean(),
});

export const automationsRoutes = new Elysia({ prefix: "/automations" })
	// === Cron Jobs ===
	.get("/jobs", () => {
		const jobs = listJobs();
		return jobs.map((job) => ({
			...job,
			nextRun: job.enabled ? getNextRun(job.schedule)?.toISOString() : null,
			scheduleDescription: describeCron(job.schedule),
		}));
	})

	.get("/jobs/:id", ({ params }) => {
		const job = getJob(params.id);
		if (!job) return { error: "Job not found" };
		return {
			...job,
			nextRun: job.enabled ? getNextRun(job.schedule)?.toISOString() : null,
			scheduleDescription: describeCron(job.schedule),
			history: getHistoryForAutomation(job.id),
		};
	})

	.post(
		"/jobs",
		async ({ body }) => {
			// Validate cron expression
			const nextRun = getNextRun(body.schedule);
			if (!nextRun) {
				return { error: "Invalid cron expression" };
			}

			const job = await createJob(body);
			return {
				...job,
				nextRun: nextRun.toISOString(),
				scheduleDescription: describeCron(job.schedule),
			};
		},
		{ body: cronJobSchema },
	)

	.patch(
		"/jobs/:id",
		async ({ params, body }) => {
			if (body.schedule) {
				const nextRun = getNextRun(body.schedule);
				if (!nextRun) {
					return { error: "Invalid cron expression" };
				}
			}

			const job = await updateJob(params.id, body);
			if (!job) return { error: "Job not found" };

			return {
				...job,
				nextRun: job.enabled ? getNextRun(job.schedule)?.toISOString() : null,
				scheduleDescription: describeCron(job.schedule),
			};
		},
		{ body: t.Partial(cronJobSchema) },
	)

	.delete("/jobs/:id", async ({ params }) => {
		const deleted = await deleteJob(params.id);
		return { ok: deleted };
	})

	.post("/jobs/:id/run", async ({ params }) => {
		return await runJobNow(params.id);
	})

	// === Webhooks ===
	.get("/webhooks", () => {
		return listWebhooks().map((w) => ({
			...w,
			url: `/api/webhooks/${w.secret}`,
		}));
	})

	.get("/webhooks/:id", ({ params }) => {
		const webhook = getWebhook(params.id);
		if (!webhook) return { error: "Webhook not found" };
		return {
			...webhook,
			url: `/api/webhooks/${webhook.secret}`,
			history: getHistoryForAutomation(webhook.id),
		};
	})

	.post(
		"/webhooks",
		async ({ body }) => {
			const webhook = await createWebhook(body);
			return {
				...webhook,
				url: `/api/webhooks/${webhook.secret}`,
			};
		},
		{ body: webhookSchema },
	)

	.patch(
		"/webhooks/:id",
		async ({ params, body }) => {
			const webhook = await updateWebhook(params.id, body);
			if (!webhook) return { error: "Webhook not found" };
			return {
				...webhook,
				url: `/api/webhooks/${webhook.secret}`,
			};
		},
		{ body: t.Partial(webhookSchema) },
	)

	.delete("/webhooks/:id", async ({ params }) => {
		const deleted = await deleteWebhook(params.id);
		return { ok: deleted };
	})

	// === History ===
	.get("/history", ({ query }) => {
		const limit = query.limit ? parseInt(query.limit, 10) : 50;
		return getHistory(limit);
	});

// Separate webhook trigger endpoint (at /api/webhooks/:secret)
export const webhookTriggerRoutes = new Elysia({ prefix: "/webhooks" }).post(
	"/:secret",
	async ({ params, body }) => {
		const webhook = getWebhookBySecret(params.secret);
		if (!webhook) {
			return { error: "Invalid webhook" };
		}

		return await triggerWebhook(webhook, body);
	},
);
