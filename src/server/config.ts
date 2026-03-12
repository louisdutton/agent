// Config storage - persisted agent configuration

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
	"agent",
);
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export type AgentConfig = {
	model: string;
	autoApproveTools: string[]; // Tools that don't require approval (e.g., "Read", "Glob")
	maxConcurrentSessions: number;
	requireApproval: boolean;
};

const DEFAULT_CONFIG: AgentConfig = {
	model: "claude-sonnet-4-20250514",
	autoApproveTools: ["Read", "Glob", "Grep"],
	maxConcurrentSessions: 5,
	requireApproval: false,
};

let cachedConfig: AgentConfig | null = null;

async function ensureDir(): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
}

export async function getConfig(): Promise<AgentConfig> {
	if (cachedConfig) return cachedConfig;

	let config: AgentConfig;

	try {
		const file = Bun.file(CONFIG_PATH);
		if (await file.exists()) {
			const data = await file.json();
			config = { ...DEFAULT_CONFIG, ...data };
			cachedConfig = config;
			return config;
		}
	} catch {
		// Use defaults
	}

	config = { ...DEFAULT_CONFIG };
	cachedConfig = config;
	return config;
}

export async function updateConfig(
	partial: Partial<AgentConfig>,
): Promise<AgentConfig> {
	const current = await getConfig();
	const updated = { ...current, ...partial };

	await ensureDir();
	await Bun.write(CONFIG_PATH, JSON.stringify(updated, null, 2));

	cachedConfig = updated;
	return updated;
}

export async function resetConfig(): Promise<AgentConfig> {
	await ensureDir();
	await Bun.write(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));

	cachedConfig = { ...DEFAULT_CONFIG };
	return cachedConfig;
}
