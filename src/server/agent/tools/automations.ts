// Automation management tools - allow assistant to manage cron jobs and webhooks

import {
	createJob,
	createWebhook,
	deleteJob,
	deleteWebhook,
	describeCron,
	getNextRun,
	listJobs,
	listWebhooks,
	runJobNow,
	updateJob,
	updateWebhook,
} from "../../scheduler";
import type { Tool, ToolResult } from "../types";

export const listAutomationsTool: Tool = {
	name: "list_automations",
	description:
		"List all scheduled cron jobs and webhooks. Returns job/webhook names, schedules, status, and recent run history.",
	inputSchema: {
		type: "object",
		properties: {},
	},
	requiresApproval: false,
	execute: async (): Promise<ToolResult> => {
		const jobs = listJobs().map((job) => ({
			id: job.id,
			type: "cron",
			name: job.name,
			schedule: job.schedule,
			scheduleDescription: describeCron(job.schedule),
			project: job.project,
			enabled: job.enabled,
			nextRun: job.enabled ? getNextRun(job.schedule)?.toISOString() : null,
			lastRun: job.lastRun ? new Date(job.lastRun).toISOString() : null,
			lastResult: job.lastResult,
		}));

		const webhooks = listWebhooks().map((webhook) => ({
			id: webhook.id,
			type: "webhook",
			name: webhook.name,
			project: webhook.project,
			enabled: webhook.enabled,
			triggerCount: webhook.triggerCount,
			lastTrigger: webhook.lastTrigger
				? new Date(webhook.lastTrigger).toISOString()
				: null,
		}));

		return {
			content: JSON.stringify({ jobs, webhooks }, null, 2),
		};
	},
};

export const createJobTool: Tool = {
	name: "create_job",
	description:
		"Create a new scheduled cron job. Schedule uses standard cron syntax (minute hour day-of-month month day-of-week). Examples: '0 9 * * *' for 9am daily, '0 9 * * 1-5' for weekdays at 9am, '*/15 * * * *' for every 15 minutes.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Human-readable name for the job",
			},
			schedule: {
				type: "string",
				description:
					"Cron expression (e.g., '0 9 * * *' for 9am daily, '0 9 * * 1-5' for weekdays)",
			},
			prompt: {
				type: "string",
				description:
					"The prompt/instruction to send to the agent when the job runs",
			},
			project: {
				type: "string",
				description: "Project path where the job should run",
			},
		},
		required: ["name", "schedule", "prompt", "project"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { name, schedule, prompt, project } = input as {
			name: string;
			schedule: string;
			prompt: string;
			project: string;
		};

		// Validate cron expression
		const nextRun = getNextRun(schedule);
		if (!nextRun) {
			return {
				content: `Invalid cron expression: "${schedule}". Use standard 5-field cron syntax.`,
				isError: true,
			};
		}

		const job = await createJob({
			name,
			schedule,
			prompt,
			project,
			enabled: true,
		});

		return {
			content: `Created job "${job.name}" (${describeCron(schedule)}). Next run: ${nextRun.toISOString()}`,
		};
	},
};

export const createWebhookTool: Tool = {
	name: "create_webhook",
	description:
		"Create a new webhook trigger. The webhook URL will be generated automatically. Use {{payload}} in the prompt to include the webhook payload.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				description: "Human-readable name for the webhook",
			},
			prompt: {
				type: "string",
				description:
					"The prompt/instruction to send when triggered. Use {{payload}} to include the request body.",
			},
			project: {
				type: "string",
				description: "Project path where the webhook should run",
			},
		},
		required: ["name", "prompt", "project"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { name, prompt, project } = input as {
			name: string;
			prompt: string;
			project: string;
		};

		const webhook = await createWebhook({
			name,
			prompt,
			project,
			enabled: true,
		});

		return {
			content: `Created webhook "${webhook.name}". URL: /api/webhooks/${webhook.secret}`,
		};
	},
};

export const toggleAutomationTool: Tool = {
	name: "toggle_automation",
	description: "Enable or disable a cron job or webhook by ID.",
	inputSchema: {
		type: "object",
		properties: {
			id: {
				type: "string",
				description: "The automation ID (job or webhook)",
			},
			type: {
				type: "string",
				enum: ["job", "webhook"],
				description: "Whether this is a job or webhook",
			},
			enabled: {
				type: "boolean",
				description: "Whether to enable (true) or disable (false)",
			},
		},
		required: ["id", "type", "enabled"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { id, type, enabled } = input as {
			id: string;
			type: "job" | "webhook";
			enabled: boolean;
		};

		if (type === "job") {
			const job = await updateJob(id, { enabled });
			if (!job) {
				return { content: `Job not found: ${id}`, isError: true };
			}
			return {
				content: `Job "${job.name}" ${enabled ? "enabled" : "disabled"}.`,
			};
		}
		const webhook = await updateWebhook(id, { enabled });
		if (!webhook) {
			return { content: `Webhook not found: ${id}`, isError: true };
		}
		return {
			content: `Webhook "${webhook.name}" ${enabled ? "enabled" : "disabled"}.`,
		};
	},
};

export const deleteAutomationTool: Tool = {
	name: "delete_automation",
	description: "Permanently delete a cron job or webhook by ID.",
	inputSchema: {
		type: "object",
		properties: {
			id: {
				type: "string",
				description: "The automation ID (job or webhook)",
			},
			type: {
				type: "string",
				enum: ["job", "webhook"],
				description: "Whether this is a job or webhook",
			},
		},
		required: ["id", "type"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { id, type } = input as {
			id: string;
			type: "job" | "webhook";
		};

		if (type === "job") {
			const deleted = await deleteJob(id);
			if (!deleted) {
				return { content: `Job not found: ${id}`, isError: true };
			}
			return { content: `Job deleted.` };
		}
		const deleted = await deleteWebhook(id);
		if (!deleted) {
			return { content: `Webhook not found: ${id}`, isError: true };
		}
		return { content: `Webhook deleted.` };
	},
};

export const runJobNowTool: Tool = {
	name: "run_job_now",
	description:
		"Immediately run a scheduled job, regardless of its cron schedule.",
	inputSchema: {
		type: "object",
		properties: {
			id: {
				type: "string",
				description: "The job ID to run",
			},
		},
		required: ["id"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { id } = input as { id: string };

		const result = await runJobNow(id);
		if (!result.ok) {
			return { content: result.error || "Failed to run job", isError: true };
		}
		return { content: `Job started.` };
	},
};
