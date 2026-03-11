// Session manager - orchestrates multiple parallel sessions

import { randomUUID } from "node:crypto";
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
};

export class SessionManager {
	private sessions = new Map<string, Session>();
	private provider: Provider;
	private tools: ToolRegistry;
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

	// Get session by ID
	get(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	// List all sessions
	list(): Session[] {
		return Array.from(this.sessions.values());
	}

	// List sessions by project
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
				message.length > 50 ? message.slice(0, 50) + "..." : message;
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

	// Delete a session
	delete(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.abortController?.abort();
			this.sessions.delete(sessionId);
			this.streamSubscribers.delete(sessionId);
			return true;
		}
		return false;
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
			// TODO: Load AGENTS.md from project for system prompt
			const systemPrompt = await this.loadSystemPrompt(session.projectPath);

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
		} catch (err) {
			console.error(`Session ${session.id} error:`, err);
			session.status = "error";
			emit({ type: "error", sessionId: session.id, error: String(err) });
			this.notifyError(session, String(err));
		} finally {
			session.updatedAt = Date.now();
			session.abortController = undefined;
			this.notifyStatus(session);
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
