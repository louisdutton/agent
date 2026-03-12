// Scheduler service - runs cron jobs and handles webhooks

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSessionManager } from "../agent/session-manager";
import { matchesCron, parseCron } from "./cron";
import type { CronJob, RunHistory, Webhook } from "./types";

const AUTOMATIONS_DIR = join(
	process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
	"agent",
	"automations",
);
const JOBS_FILE = join(AUTOMATIONS_DIR, "jobs.json");
const WEBHOOKS_FILE = join(AUTOMATIONS_DIR, "webhooks.json");
const HISTORY_FILE = join(AUTOMATIONS_DIR, "history.json");

const MAX_HISTORY = 100;

type SchedulerState = {
	jobs: Map<string, CronJob>;
	webhooks: Map<string, Webhook>;
	history: RunHistory[];
	running: boolean;
	checkInterval: ReturnType<typeof setInterval> | null;
	lastCheck: Map<string, number>; // Track last run time per job
};

const state: SchedulerState = {
	jobs: new Map(),
	webhooks: new Map(),
	history: [],
	running: false,
	checkInterval: null,
	lastCheck: new Map(),
};

// Persistence helpers
async function ensureDir(): Promise<void> {
	await mkdir(AUTOMATIONS_DIR, { recursive: true });
}

async function loadJobs(): Promise<void> {
	try {
		const file = Bun.file(JOBS_FILE);
		if (await file.exists()) {
			const data = (await file.json()) as CronJob[];
			state.jobs = new Map(data.map((j) => [j.id, j]));
		}
	} catch {
		// Start fresh
	}
}

async function saveJobs(): Promise<void> {
	await ensureDir();
	await Bun.write(
		JOBS_FILE,
		JSON.stringify(Array.from(state.jobs.values()), null, 2),
	);
}

async function loadWebhooks(): Promise<void> {
	try {
		const file = Bun.file(WEBHOOKS_FILE);
		if (await file.exists()) {
			const data = (await file.json()) as Webhook[];
			state.webhooks = new Map(data.map((w) => [w.id, w]));
		}
	} catch {
		// Start fresh
	}
}

async function saveWebhooks(): Promise<void> {
	await ensureDir();
	await Bun.write(
		WEBHOOKS_FILE,
		JSON.stringify(Array.from(state.webhooks.values()), null, 2),
	);
}

async function loadHistory(): Promise<void> {
	try {
		const file = Bun.file(HISTORY_FILE);
		if (await file.exists()) {
			state.history = (await file.json()) as RunHistory[];
		}
	} catch {
		// Start fresh
	}
}

async function saveHistory(): Promise<void> {
	await ensureDir();
	// Keep only recent history
	if (state.history.length > MAX_HISTORY) {
		state.history = state.history.slice(-MAX_HISTORY);
	}
	await Bun.write(HISTORY_FILE, JSON.stringify(state.history, null, 2));
}

async function addHistory(entry: RunHistory): Promise<void> {
	state.history.push(entry);
	await saveHistory();
}

async function updateHistory(
	id: string,
	update: Partial<RunHistory>,
): Promise<void> {
	const entry = state.history.find((h) => h.id === id);
	if (entry) {
		Object.assign(entry, update);
		await saveHistory();
	}
}

// Execute a job by creating a session
async function executeJob(job: CronJob): Promise<void> {
	const historyId = randomUUID();
	const manager = getSessionManager();

	// Create session
	const session = manager.create(job.project);

	await addHistory({
		id: historyId,
		type: "cron",
		automationId: job.id,
		automationName: job.name,
		sessionId: session.id,
		project: job.project,
		startedAt: Date.now(),
		status: "running",
	});

	try {
		// Subscribe to completion
		const done = new Promise<void>((resolve, reject) => {
			const unsub = manager.subscribeToSession(session.id, (event) => {
				if (event.type === "turn_end") {
					unsub();
					resolve();
				} else if (event.type === "error") {
					unsub();
					reject(new Error(event.error));
				}
			});
		});

		// Send message
		await manager.sendMessage(session.id, job.prompt);
		await done;

		// Update job status
		job.lastRun = Date.now();
		job.lastResult = "success";
		job.lastError = undefined;
		await saveJobs();

		await updateHistory(historyId, {
			completedAt: Date.now(),
			status: "success",
		});
	} catch (err) {
		job.lastRun = Date.now();
		job.lastResult = "error";
		job.lastError = String(err);
		await saveJobs();

		await updateHistory(historyId, {
			completedAt: Date.now(),
			status: "error",
			error: String(err),
		});
	}
}

// Check and run due jobs
async function checkJobs(): Promise<void> {
	const now = new Date();
	const currentMinute = Math.floor(now.getTime() / 60000);

	for (const job of state.jobs.values()) {
		if (!job.enabled) continue;

		const cron = parseCron(job.schedule);
		if (!cron) continue;

		// Check if this job should run now
		if (!matchesCron(cron, now)) continue;

		// Prevent running same job twice in same minute
		const lastCheck = state.lastCheck.get(job.id) ?? 0;
		if (lastCheck === currentMinute) continue;

		state.lastCheck.set(job.id, currentMinute);

		// Run job in background
		console.info(`[Scheduler] Running job: ${job.name}`);
		executeJob(job).catch((err) => {
			console.error(`[Scheduler] Job ${job.name} failed:`, err);
		});
	}
}

// Public API
export async function initScheduler(): Promise<void> {
	await loadJobs();
	await loadWebhooks();
	await loadHistory();
}

export function startScheduler(): void {
	if (state.running) return;

	state.running = true;
	// Check every minute
	state.checkInterval = setInterval(checkJobs, 60_000);
	// Also check immediately
	checkJobs();

	console.info("[Scheduler] Started");
}

export function stopScheduler(): void {
	if (!state.running) return;

	state.running = false;
	if (state.checkInterval) {
		clearInterval(state.checkInterval);
		state.checkInterval = null;
	}

	console.info("[Scheduler] Stopped");
}

// Job management
export function listJobs(): CronJob[] {
	return Array.from(state.jobs.values());
}

export function getJob(id: string): CronJob | undefined {
	return state.jobs.get(id);
}

export async function createJob(
	data: Omit<CronJob, "id" | "createdAt" | "updatedAt">,
): Promise<CronJob> {
	const job: CronJob = {
		...data,
		id: randomUUID(),
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	state.jobs.set(job.id, job);
	await saveJobs();
	return job;
}

export async function updateJob(
	id: string,
	data: Partial<Omit<CronJob, "id" | "createdAt">>,
): Promise<CronJob | null> {
	const job = state.jobs.get(id);
	if (!job) return null;

	Object.assign(job, data, { updatedAt: Date.now() });
	await saveJobs();
	return job;
}

export async function deleteJob(id: string): Promise<boolean> {
	const deleted = state.jobs.delete(id);
	if (deleted) {
		await saveJobs();
	}
	return deleted;
}

export async function runJobNow(
	id: string,
): Promise<{ ok: boolean; error?: string }> {
	const job = state.jobs.get(id);
	if (!job) return { ok: false, error: "Job not found" };

	try {
		await executeJob(job);
		return { ok: true };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// Webhook management
export function listWebhooks(): Webhook[] {
	return Array.from(state.webhooks.values());
}

export function getWebhook(id: string): Webhook | undefined {
	return state.webhooks.get(id);
}

export function getWebhookBySecret(secret: string): Webhook | undefined {
	return Array.from(state.webhooks.values()).find((w) => w.secret === secret);
}

export async function createWebhook(
	data: Omit<
		Webhook,
		"id" | "secret" | "createdAt" | "updatedAt" | "triggerCount"
	>,
): Promise<Webhook> {
	const webhook: Webhook = {
		...data,
		id: randomUUID(),
		secret: randomUUID().replace(/-/g, ""),
		createdAt: Date.now(),
		updatedAt: Date.now(),
		triggerCount: 0,
	};
	state.webhooks.set(webhook.id, webhook);
	await saveWebhooks();
	return webhook;
}

export async function updateWebhook(
	id: string,
	data: Partial<Omit<Webhook, "id" | "secret" | "createdAt">>,
): Promise<Webhook | null> {
	const webhook = state.webhooks.get(id);
	if (!webhook) return null;

	Object.assign(webhook, data, { updatedAt: Date.now() });
	await saveWebhooks();
	return webhook;
}

export async function deleteWebhook(id: string): Promise<boolean> {
	const deleted = state.webhooks.delete(id);
	if (deleted) {
		await saveWebhooks();
	}
	return deleted;
}

export async function triggerWebhook(
	webhook: Webhook,
	payload: unknown,
): Promise<{ ok: boolean; sessionId?: string; error?: string }> {
	if (!webhook.enabled) {
		return { ok: false, error: "Webhook is disabled" };
	}

	const historyId = randomUUID();
	const manager = getSessionManager();

	// Create session
	const session = manager.create(webhook.project);

	// Replace {{payload}} with actual payload
	const prompt = webhook.prompt.replace(
		/\{\{payload\}\}/g,
		JSON.stringify(payload, null, 2),
	);

	await addHistory({
		id: historyId,
		type: "webhook",
		automationId: webhook.id,
		automationName: webhook.name,
		sessionId: session.id,
		project: webhook.project,
		startedAt: Date.now(),
		status: "running",
	});

	try {
		// Update webhook stats
		webhook.lastTrigger = Date.now();
		webhook.triggerCount++;
		await saveWebhooks();

		// Send message (don't wait for completion)
		manager.sendMessage(session.id, prompt).catch(console.error);

		// Update history when done (in background)
		const unsub = manager.subscribeToSession(session.id, (event) => {
			if (event.type === "turn_end") {
				unsub();
				updateHistory(historyId, {
					completedAt: Date.now(),
					status: "success",
				});
			} else if (event.type === "error") {
				unsub();
				updateHistory(historyId, {
					completedAt: Date.now(),
					status: "error",
					error: event.error,
				});
			}
		});

		return { ok: true, sessionId: session.id };
	} catch (err) {
		await updateHistory(historyId, {
			completedAt: Date.now(),
			status: "error",
			error: String(err),
		});
		return { ok: false, error: String(err) };
	}
}

// History
export function getHistory(limit = 50): RunHistory[] {
	return state.history.slice(-limit).reverse();
}

export function getHistoryForAutomation(
	automationId: string,
	limit = 20,
): RunHistory[] {
	return state.history
		.filter((h) => h.automationId === automationId)
		.slice(-limit)
		.reverse();
}
