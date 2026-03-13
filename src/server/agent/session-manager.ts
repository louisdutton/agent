// Session manager - orchestrates multiple parallel sessions with JSONL persistence

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAnthropicProvider } from "../providers/anthropic";
import type { ContentPart, Message, Provider } from "../providers/types";
import type {
	ApprovalRequest,
	NotificationEvent,
	WireEvent,
} from "../wire/types";
import { runAgentLoop } from "./loop";
import { createDefaultToolRegistry, type ToolRegistry } from "./tools";
import type { Session, ToolCall } from "./types";

type SessionManagerConfig = {
	model?: string;
	apiKey?: string;
	provider?: Provider; // For testing
	tools?: ToolRegistry; // For testing
	transcriptsDir?: string; // For testing
};

// Session metadata stored in first line of transcript
type SessionMeta = {
	id: string;
	projectPath: string;
	title?: string;
	createdAt: number;
	updatedAt: number;
};

// Transcript entry format
type TranscriptEntry =
	| { type: "meta"; data: SessionMeta }
	| {
			type: "message";
			role: "user" | "assistant";
			content: Message["content"];
	  };

export class SessionManager {
	private sessions = new Map<string, Session>();
	private provider: Provider;
	private tools: ToolRegistry;
	private transcriptsDir: string;
	private notificationSubscribers = new Set<
		(event: NotificationEvent) => void
	>();
	private streamSubscribers = new Map<
		string,
		Set<(event: WireEvent) => void>
	>();

	constructor(config: SessionManagerConfig = {}) {
		this.provider =
			config.provider ??
			createAnthropicProvider({
				apiKey: config.apiKey,
				model: config.model,
			});
		this.tools = config.tools ?? createDefaultToolRegistry();
		this.transcriptsDir =
			config.transcriptsDir ??
			join(
				process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
				"agent",
				"sessions",
			);
	}

	// Get transcript directory for a project
	private getProjectDir(projectPath: string): string {
		// Convert project path to safe directory name (same as Claude CLI)
		const safeName = projectPath.replace(/\//g, "-").replace(/^-/, "");
		return join(this.transcriptsDir, safeName);
	}

	// Get transcript file path for a session
	private getTranscriptPath(projectPath: string, sessionId: string): string {
		return join(this.getProjectDir(projectPath), `${sessionId}.jsonl`);
	}

	// Persist session to JSONL
	private async persistSession(session: Session): Promise<void> {
		const dir = this.getProjectDir(session.projectPath);
		await mkdir(dir, { recursive: true });

		const path = this.getTranscriptPath(session.projectPath, session.id);
		const lines: string[] = [];

		// Meta entry
		const meta: SessionMeta = {
			id: session.id,
			projectPath: session.projectPath,
			title: session.title,
			createdAt: session.createdAt,
			updatedAt: session.updatedAt,
		};
		lines.push(JSON.stringify({ type: "meta", data: meta }));

		// Message entries
		for (const msg of session.messages) {
			lines.push(
				JSON.stringify({
					type: "message",
					role: msg.role,
					content: msg.content,
				}),
			);
		}

		await Bun.write(path, `${lines.join("\n")}\n`);
	}

	// Load session from transcript file
	private async loadSession(
		projectPath: string,
		sessionId: string,
	): Promise<Session | null> {
		const path = this.getTranscriptPath(projectPath, sessionId);
		const file = Bun.file(path);

		if (!(await file.exists())) return null;

		const content = await file.text();
		const lines = content.trim().split("\n").filter(Boolean);

		let meta: SessionMeta | null = null;
		const messages: Message[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as TranscriptEntry;
				if (entry.type === "meta") {
					meta = entry.data;
				} else if (entry.type === "message") {
					messages.push({ role: entry.role, content: entry.content });
				}
			} catch {
				// Skip invalid lines
			}
		}

		if (!meta) return null;

		// Fix incomplete tool calls: if last assistant message has tool_use without
		// a following tool_result, add stub results to maintain valid message structure
		this.fixIncompleteToolCalls(messages);

		return {
			id: meta.id,
			projectPath: meta.projectPath,
			title: meta.title,
			createdAt: meta.createdAt,
			updatedAt: meta.updatedAt,
			status: "idle",
			messages,
		};
	}

	// Fix messages that have tool_use without corresponding tool_result
	// This can happen when a session is interrupted mid-tool-execution
	private fixIncompleteToolCalls(messages: Message[]): void {
		if (messages.length === 0) return;

		// Collect all tool_use IDs that have results
		const toolIdsWithResults = new Set<string>();
		for (const msg of messages) {
			if (msg.role === "user" && Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "tool_result") {
						toolIdsWithResults.add(part.toolUseId);
					}
				}
			}
		}

		// Find all tool_use blocks without results
		const orphanedToolUses: Array<{ id: string; name: string }> = [];
		for (const msg of messages) {
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === "tool_use" && !toolIdsWithResults.has(part.id)) {
						orphanedToolUses.push({ id: part.id, name: part.name });
					}
				}
			}
		}

		if (orphanedToolUses.length === 0) return;

		// Add stub tool_result for each orphaned tool_use
		const toolResults: ContentPart[] = orphanedToolUses.map((tu) => ({
			type: "tool_result" as const,
			toolUseId: tu.id,
			content: "[Session interrupted - tool execution was cancelled]",
			isError: true,
		}));

		messages.push({
			role: "user",
			content: toolResults,
		});
	}

	// List all sessions for a project from disk
	async listFromDisk(projectPath: string): Promise<
		Array<{
			sessionId: string;
			title: string;
			createdAt: number;
			updatedAt: number;
		}>
	> {
		const dir = this.getProjectDir(projectPath);

		try {
			const files = await readdir(dir);
			const sessions: Array<{
				sessionId: string;
				title: string;
				createdAt: number;
				updatedAt: number;
			}> = [];

			for (const file of files) {
				if (!file.endsWith(".jsonl")) continue;

				const sessionId = file.replace(".jsonl", "");
				const path = join(dir, file);

				try {
					// Read just the first line for meta
					const content = await Bun.file(path).text();
					const firstLine = content.split("\n")[0];
					const entry = JSON.parse(firstLine) as TranscriptEntry;

					if (entry.type === "meta") {
						sessions.push({
							sessionId: entry.data.id,
							title: entry.data.title || "Untitled",
							createdAt: entry.data.createdAt,
							updatedAt: entry.data.updatedAt,
						});
					}
				} catch {
					// Try to get timestamps from file stats
					const stats = await stat(path);
					sessions.push({
						sessionId,
						title: "Untitled",
						createdAt: stats.birthtimeMs,
						updatedAt: stats.mtimeMs,
					});
				}
			}

			return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
		} catch {
			return [];
		}
	}

	// Get session history from disk (for UI display)
	async getHistory(
		projectPath: string,
		sessionId: string,
	): Promise<{ messages: Message[]; title?: string } | null> {
		// Check in-memory first
		const inMemory = this.sessions.get(sessionId);
		if (inMemory) {
			return { messages: inMemory.messages, title: inMemory.title };
		}

		// Load from disk
		const session = await this.loadSession(projectPath, sessionId);
		if (!session) return null;

		return { messages: session.messages, title: session.title };
	}

	// Create a new session
	create(projectPath: string): Session {
		const session: Session = {
			id: randomUUID(),
			projectPath,
			status: "idle",
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this.sessions.set(session.id, session);
		return session;
	}

	// Get session by ID (in-memory only)
	get(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	// Resume a session from disk (loads into memory)
	async resume(
		projectPath: string,
		sessionId: string,
	): Promise<Session | null> {
		const session = await this.loadSession(projectPath, sessionId);
		if (!session) return null;

		// Add to in-memory map
		this.sessions.set(sessionId, session);
		return session;
	}

	// List all in-memory sessions
	list(): Session[] {
		return Array.from(this.sessions.values());
	}

	// List in-memory sessions by project
	listByProject(projectPath: string): Session[] {
		return this.list().filter((s) => s.projectPath === projectPath);
	}

	// Send a message to a session (starts agent loop)
	async sendMessage(
		sessionId: string,
		message: string,
		images?: string[],
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session not found: ${sessionId}`);
		}

		if (session.status === "running") {
			throw new Error("Session is already running");
		}

		// Build user message content
		const content = this.buildUserContent(message, images);
		session.messages.push({ role: "user", content });
		session.status = "running";
		session.updatedAt = Date.now();
		session.abortController = new AbortController();

		// Set title from first message
		if (!session.title) {
			session.title =
				message.length > 50 ? `${message.slice(0, 50)}...` : message;
		}

		this.notifyStatus(session);

		// Run agent loop in background
		this.runInBackground(session);
	}

	// Respond to an approval request
	respondToApproval(sessionId: string, approved: boolean): void {
		const session = this.sessions.get(sessionId);
		if (!session?.approvalResolver) {
			return;
		}
		session.approvalResolver(approved);
		session.approvalResolver = undefined;
		session.pendingApproval = undefined;
	}

	// Cancel a running session
	cancel(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) return false;

		session.abortController?.abort();
		session.status = "idle";
		session.updatedAt = Date.now();
		this.notifyStatus(session);
		return true;
	}

	// Delete a session (memory and disk)
	async delete(sessionId: string, projectPath?: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);

		if (session) {
			session.abortController?.abort();
			this.sessions.delete(sessionId);
			this.streamSubscribers.delete(sessionId);
			projectPath = session.projectPath;
		}

		// Delete from disk if we have project path
		if (projectPath) {
			const path = this.getTranscriptPath(projectPath, sessionId);
			try {
				await rm(path);
			} catch {
				// Ignore if file doesn't exist
			}
		}

		return true;
	}

	// Subscribe to notifications (all sessions)
	subscribeToNotifications(
		callback: (event: NotificationEvent) => void,
	): () => void {
		this.notificationSubscribers.add(callback);
		return () => this.notificationSubscribers.delete(callback);
	}

	// Subscribe to a specific session's stream
	subscribeToSession(
		sessionId: string,
		callback: (event: WireEvent) => void,
	): () => void {
		let subs = this.streamSubscribers.get(sessionId);
		if (!subs) {
			subs = new Set();
			this.streamSubscribers.set(sessionId, subs);
		}
		subs.add(callback);
		return () => subs?.delete(callback);
	}

	// Run agent loop in background
	private async runInBackground(session: Session): Promise<void> {
		const emit = (event: WireEvent) => {
			const subs = this.streamSubscribers.get(session.id);
			if (subs) {
				for (const cb of subs) {
					try {
						cb(event);
					} catch (err) {
						console.error("Stream subscriber error:", err);
					}
				}
			}
		};

		const requestApproval = async (toolCall: ToolCall): Promise<boolean> => {
			return new Promise((resolve) => {
				const request: ApprovalRequest = {
					id: randomUUID(),
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					input: toolCall.input,
					description: `Execute ${toolCall.name}`,
				};

				session.status = "waiting";
				session.pendingApproval = request;
				session.approvalResolver = resolve;
				session.updatedAt = Date.now();

				// Notify all clients
				this.notifyApproval(session, request);
				emit({ type: "approval_needed", sessionId: session.id, request });
			});
		};

		try {
			// Auto-compact if context is getting large
			await this.maybeCompact(session);

			// Use context-injected prompt if this is a spawned task
			const systemPrompt = session.context?.systemPrompt
				? await this.loadSystemPrompt(session.projectPath).then(
						(base) => `${base}\n\n${session.context?.systemPrompt}`,
					)
				: await this.loadSystemPrompt(session.projectPath);

			await runAgentLoop(
				session,
				this.provider,
				this.tools,
				systemPrompt,
				emit,
				requestApproval,
				{ signal: session.abortController?.signal },
			);

			session.status = "completed";

			// Report outcome if this was a spawned task
			if (session.context) {
				await this.reportOutcome(session, "completed");
			}
		} catch (err) {
			console.error(`Session ${session.id} error:`, err);
			session.status = "error";
			emit({ type: "error", sessionId: session.id, error: String(err) });
			this.notifyError(session, String(err));

			// Report error outcome if this was a spawned task
			if (session.context) {
				await this.reportOutcome(session, "error");
			}
		} finally {
			session.updatedAt = Date.now();
			session.abortController = undefined;
			this.notifyStatus(session);

			// Persist to disk after turn completes
			try {
				await this.persistSession(session);
			} catch (err) {
				console.error("Failed to persist session:", err);
			}
		}
	}

	private async loadSystemPrompt(projectPath: string): Promise<string> {
		const basePrompt =
			"You are a helpful coding assistant. Be concise and accurate.";

		// Try to load AGENTS.md
		try {
			const agentsFile = Bun.file(`${projectPath}/AGENTS.md`);
			if (await agentsFile.exists()) {
				const content = await agentsFile.text();
				return `${basePrompt}\n\n# Project Instructions\n\n${content}`;
			}
		} catch {
			// Ignore errors
		}

		return basePrompt;
	}

	private buildUserContent(
		message: string,
		images?: string[],
	): Message["content"] {
		if (!images?.length) {
			return message;
		}

		const content: ContentPart[] = [];

		for (const img of images) {
			const match = img.match(/^data:([^;]+);base64,(.+)$/);
			if (match) {
				content.push({
					type: "image",
					mediaType: match[1],
					data: match[2],
				});
			}
		}

		if (message) {
			content.push({ type: "text", text: message });
		}

		return content;
	}

	// Compact session by summarizing old messages
	async compact(sessionId: string): Promise<{ ok: boolean; error?: string }> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { ok: false, error: "Session not found" };
		}

		if (session.messages.length < 6) {
			return { ok: true }; // Nothing to compact
		}

		// Keep last 4 messages (2 turns), summarize the rest
		const toSummarize = session.messages.slice(0, -4);
		const toKeep = session.messages.slice(-4);

		// Build summary prompt
		const summaryText = toSummarize
			.map((m) => {
				const content =
					typeof m.content === "string"
						? m.content
						: m.content
								.filter((p) => p.type === "text" || p.type === "tool_result")
								.map((p) =>
									"text" in p ? p.text : "content" in p ? p.content : "",
								)
								.join("\n");
				return `${m.role.toUpperCase()}: ${content}`;
			})
			.join("\n\n");

		const { prompt: anthropicPrompt } = await import("../anthropic");
		const result = await anthropicPrompt(
			`Summarize this conversation history concisely, preserving key decisions, file changes, and context needed for continuation:\n\n${summaryText}`,
			{
				system:
					"You are a conversation summarizer. Output a brief summary preserving key technical details, decisions made, files modified, and important context. Be concise but complete.",
				maxTokens: 1024,
			},
		);

		if (!result.ok) {
			return { ok: false, error: result.error };
		}

		// Replace old messages with summary
		session.messages = [
			{
				role: "user",
				content: `[Previous conversation summary]\n${result.text}`,
			},
			{
				role: "assistant",
				content: "I understand the context. Let me continue helping you.",
			},
			...toKeep,
		];

		session.updatedAt = Date.now();
		await this.persistSession(session);

		return { ok: true };
	}

	// Estimate token count for messages
	estimateTokens(messages: Message[]): number {
		let chars = 0;
		for (const msg of messages) {
			if (typeof msg.content === "string") {
				chars += msg.content.length;
			} else {
				for (const part of msg.content) {
					if ("text" in part) chars += part.text.length;
					if ("content" in part) chars += part.content.length;
				}
			}
		}
		// Rough estimate: 4 chars per token
		return Math.ceil(chars / 4);
	}

	// Auto-compact if needed before running agent loop
	private async maybeCompact(session: Session): Promise<void> {
		const tokens = this.estimateTokens(session.messages);
		const threshold = this.provider.maxContextTokens * 0.7; // 70% of max

		if (tokens > threshold && session.messages.length >= 6) {
			await this.compact(session.id);
		}
	}

	// Report outcome from a completed/errored task to assistant
	private async reportOutcome(
		session: Session,
		status: "completed" | "error",
	): Promise<void> {
		const { getAssistantManager } = await import("../assistant/assistant");
		const { extractLearnings, generateOutcomeSummary } = await import(
			"../assistant/context"
		);

		const assistant = getAssistantManager();

		// Get the last assistant message as final result
		const lastAssistantMsg = [...session.messages]
			.reverse()
			.find((m) => m.role === "assistant");
		const finalMessage =
			typeof lastAssistantMsg?.content === "string"
				? lastAssistantMsg.content
				: lastAssistantMsg?.content
						?.filter((p) => p.type === "text")
						.map((p) => (p as { text: string }).text)
						.join("\n") || "";

		// Extract learnings from conversation
		const allMessages = session.messages
			.filter((m) => m.role === "assistant")
			.map((m) =>
				typeof m.content === "string"
					? m.content
					: m.content
							.filter((p) => p.type === "text")
							.map((p) => (p as { text: string }).text)
							.join("\n"),
			);
		const learnings = extractLearnings(allMessages);

		// Generate summary
		const summary = generateOutcomeSummary(
			session.title || "Task",
			finalMessage,
			status,
		);

		// Store outcome on session
		session.outcome = {
			taskId: session.id,
			status,
			summary,
			learnings: learnings.length > 0 ? learnings : undefined,
		};

		// Process outcome (stores learnings in memory)
		await assistant.processOutcome(session.outcome);
	}

	private notifyStatus(session: Session): void {
		const event: NotificationEvent = {
			type: "session_status",
			sessionId: session.id,
			projectPath: session.projectPath,
			status: session.status,
			title: session.title,
		};
		for (const cb of this.notificationSubscribers) {
			try {
				cb(event);
			} catch (err) {
				console.error("Notification subscriber error:", err);
			}
		}
	}

	private notifyApproval(session: Session, request: ApprovalRequest): void {
		const event: NotificationEvent = {
			type: "approval_needed",
			sessionId: session.id,
			projectPath: session.projectPath,
			request,
		};
		for (const cb of this.notificationSubscribers) {
			try {
				cb(event);
			} catch (err) {
				console.error("Notification subscriber error:", err);
			}
		}
	}

	private notifyError(session: Session, error: string): void {
		const event: NotificationEvent = {
			type: "session_error",
			sessionId: session.id,
			projectPath: session.projectPath,
			error,
		};
		for (const cb of this.notificationSubscribers) {
			try {
				cb(event);
			} catch (err) {
				console.error("Notification subscriber error:", err);
			}
		}
	}
}

// Singleton instance
let instance: SessionManager | null = null;

export function getSessionManager(
	config?: SessionManagerConfig,
): SessionManager {
	if (!instance) {
		instance = new SessionManager(config);
	}
	return instance;
}
