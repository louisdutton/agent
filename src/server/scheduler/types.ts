// Scheduler types

export type CronJob = {
	id: string;
	name: string;
	schedule: string; // cron expression (e.g., "0 9 * * *" for 9am daily)
	prompt: string; // What to ask the agent
	project: string; // Project path
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
	lastRun?: number;
	lastResult?: "success" | "error";
	lastError?: string;
};

export type Webhook = {
	id: string;
	name: string;
	secret: string; // For HMAC validation
	prompt: string; // Template with {{payload}} placeholder
	project: string;
	enabled: boolean;
	createdAt: number;
	updatedAt: number;
	lastTrigger?: number;
	triggerCount: number;
};

export type RunHistory = {
	id: string;
	type: "cron" | "webhook";
	automationId: string;
	automationName: string;
	sessionId: string;
	project: string;
	startedAt: number;
	completedAt?: number;
	status: "running" | "success" | "error";
	error?: string;
};
