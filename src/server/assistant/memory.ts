// Memory store - JSONL persistence for assistant memory

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { MemoryEntry } from "./types";

function getDefaultMemoryPath(): string {
	const dataDir =
		process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
	return join(dataDir, "agent", "assistant", "memory.jsonl");
}

export class MemoryStore {
	private entries: MemoryEntry[] = [];
	private loaded = false;
	private memoryPath: string;

	constructor(memoryPath?: string) {
		// Compute path at construction time (allows env to be set before construction)
		this.memoryPath = memoryPath ?? getDefaultMemoryPath();
	}

	async load(): Promise<void> {
		if (this.loaded) return;

		try {
			const file = Bun.file(this.memoryPath);
			if (await file.exists()) {
				const content = await file.text();
				const lines = content.trim().split("\n").filter(Boolean);
				for (const line of lines) {
					try {
						const entry = JSON.parse(line) as MemoryEntry;
						this.entries.push(entry);
					} catch {
						// Skip invalid lines
					}
				}
			}
		} catch {
			// File doesn't exist yet, that's fine
		}

		this.loaded = true;
	}

	async add(
		type: MemoryEntry["type"],
		content: string,
		options: { context?: string; tags?: string[] } = {},
	): Promise<MemoryEntry> {
		await this.load();

		const entry: MemoryEntry = {
			id: randomUUID(),
			type,
			content,
			context: options.context,
			tags: options.tags,
			createdAt: Date.now(),
		};

		this.entries.push(entry);
		await this.persist(entry);

		return entry;
	}

	async query(options: {
		type?: MemoryEntry["type"];
		tags?: string[];
		keywords?: string[];
		limit?: number;
	}): Promise<MemoryEntry[]> {
		await this.load();

		let results = [...this.entries];

		// Filter by type
		if (options.type) {
			results = results.filter((e) => e.type === options.type);
		}

		// Filter by tags (any match)
		if (options.tags?.length) {
			results = results.filter((e) =>
				options.tags?.some((t) => e.tags?.includes(t)),
			);
		}

		// Filter by keywords (search in content and context)
		if (options.keywords?.length) {
			const lowerKeywords = options.keywords.map((k) => k.toLowerCase());
			results = results.filter((e) => {
				const searchText = `${e.content} ${e.context || ""}`.toLowerCase();
				return lowerKeywords.some((k) => searchText.includes(k));
			});
		}

		// Sort by recency
		results.sort((a, b) => b.createdAt - a.createdAt);

		// Apply limit
		if (options.limit) {
			results = results.slice(0, options.limit);
		}

		return results;
	}

	async remove(id: string): Promise<boolean> {
		await this.load();

		const index = this.entries.findIndex((e) => e.id === id);
		if (index === -1) return false;

		this.entries.splice(index, 1);

		// Rewrite entire file (simple approach for now)
		await this.rewriteAll();

		return true;
	}

	async getAll(): Promise<MemoryEntry[]> {
		await this.load();
		return [...this.entries];
	}

	private async persist(entry: MemoryEntry): Promise<void> {
		await mkdir(dirname(this.memoryPath), { recursive: true });
		await appendFile(this.memoryPath, `${JSON.stringify(entry)}\n`);
	}

	private async rewriteAll(): Promise<void> {
		await mkdir(dirname(this.memoryPath), { recursive: true });
		const content = this.entries.map((e) => JSON.stringify(e)).join("\n");
		await Bun.write(this.memoryPath, content ? `${content}\n` : "");
	}
}

// Singleton instance
let instance: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
	if (!instance) {
		instance = new MemoryStore();
	}
	return instance;
}
