// Session management tools - allow assistant to manage active and historical sessions

import { getSessionManager } from "../session-manager";
import type { Tool, ToolResult } from "../types";

export const listActiveSessionsTool: Tool = {
	name: "list_active_sessions",
	description:
		"List all currently active sessions in memory. Shows running, waiting, and recently completed sessions with their status and project.",
	inputSchema: {
		type: "object",
		properties: {},
	},
	requiresApproval: false,
	execute: async (): Promise<ToolResult> => {
		const sessions = getSessionManager().list();

		if (sessions.length === 0) {
			return { content: "No active sessions." };
		}

		const formatted = sessions.map((s) => ({
			id: s.id,
			project: s.projectPath.split("/").pop() || s.projectPath,
			projectPath: s.projectPath,
			status: s.status,
			title: s.title || "Untitled",
			messageCount: s.messages.length,
			createdAt: new Date(s.createdAt).toISOString(),
			updatedAt: new Date(s.updatedAt).toISOString(),
		}));

		return { content: JSON.stringify(formatted, null, 2) };
	},
};

export const listSessionHistoryTool: Tool = {
	name: "list_session_history",
	description:
		"List saved sessions for a project from disk. Returns session IDs, titles, and timestamps.",
	inputSchema: {
		type: "object",
		properties: {
			project: {
				type: "string",
				description: "Project path to list sessions for",
			},
			limit: {
				type: "number",
				description: "Maximum number of sessions to return (default: 20)",
			},
		},
		required: ["project"],
	},
	requiresApproval: false,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { project, limit = 20 } = input as {
			project: string;
			limit?: number;
		};

		const sessions = await getSessionManager().listFromDisk(project);
		const limited = sessions.slice(0, limit);

		if (limited.length === 0) {
			return { content: `No sessions found for project: ${project}` };
		}

		const formatted = limited.map((s) => ({
			id: s.sessionId,
			title: s.title,
			created: new Date(s.createdAt).toISOString(),
			modified: new Date(s.updatedAt).toISOString(),
		}));

		return { content: JSON.stringify(formatted, null, 2) };
	},
};

export const viewSessionTool: Tool = {
	name: "view_session",
	description:
		"View the conversation history of a specific session. Shows user and assistant messages.",
	inputSchema: {
		type: "object",
		properties: {
			sessionId: {
				type: "string",
				description: "The session ID to view",
			},
			project: {
				type: "string",
				description: "Project path (required if session is not in memory)",
			},
			lastN: {
				type: "number",
				description: "Only show the last N messages (default: all)",
			},
		},
		required: ["sessionId"],
	},
	requiresApproval: false,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { sessionId, project, lastN } = input as {
			sessionId: string;
			project?: string;
			lastN?: number;
		};

		// Try in-memory first
		const manager = getSessionManager();
		let messages = manager.get(sessionId)?.messages;
		let title = manager.get(sessionId)?.title;

		// Fall back to disk
		if (!messages && project) {
			const history = await manager.getHistory(project, sessionId);
			if (history) {
				messages = history.messages;
				title = history.title;
			}
		}

		if (!messages) {
			return {
				content: `Session not found: ${sessionId}. If loading from disk, provide the project path.`,
				isError: true,
			};
		}

		// Apply lastN filter
		const filtered = lastN ? messages.slice(-lastN) : messages;

		const formatted = filtered.map((m, i) => {
			const content =
				typeof m.content === "string"
					? m.content
					: m.content
							.filter((p) => p.type === "text")
							.map((p) => (p as { text: string }).text)
							.join("\n");

			// Truncate very long messages
			const truncated =
				content.length > 2000 ? content.slice(0, 2000) + "..." : content;

			return `[${i + 1}] ${m.role.toUpperCase()}:\n${truncated}`;
		});

		const header = title ? `Session: ${title}\n${"=".repeat(40)}\n\n` : "";
		return { content: header + formatted.join("\n\n---\n\n") };
	},
};

export const cancelSessionTool: Tool = {
	name: "cancel_session",
	description:
		"Cancel a running session. Stops any in-progress agent execution.",
	inputSchema: {
		type: "object",
		properties: {
			sessionId: {
				type: "string",
				description: "The session ID to cancel",
			},
		},
		required: ["sessionId"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { sessionId } = input as { sessionId: string };

		const cancelled = getSessionManager().cancel(sessionId);

		if (!cancelled) {
			return { content: `Session not found: ${sessionId}`, isError: true };
		}

		return { content: `Session ${sessionId} cancelled.` };
	},
};

export const deleteSessionTool: Tool = {
	name: "delete_session",
	description:
		"Permanently delete a session from memory and disk. This cannot be undone.",
	inputSchema: {
		type: "object",
		properties: {
			sessionId: {
				type: "string",
				description: "The session ID to delete",
			},
			project: {
				type: "string",
				description: "Project path (required to delete from disk)",
			},
		},
		required: ["sessionId", "project"],
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { sessionId, project } = input as {
			sessionId: string;
			project: string;
		};

		await getSessionManager().delete(sessionId, project);

		return { content: `Session ${sessionId} deleted.` };
	},
};

export const compactSessionTool: Tool = {
	name: "compact_session",
	description:
		"Compact a session by summarizing older messages to reduce context size. Useful for long-running sessions.",
	inputSchema: {
		type: "object",
		properties: {
			sessionId: {
				type: "string",
				description: "The session ID to compact",
			},
		},
		required: ["sessionId"],
	},
	requiresApproval: false,
	execute: async (input: unknown): Promise<ToolResult> => {
		const { sessionId } = input as { sessionId: string };

		const result = await getSessionManager().compact(sessionId);

		if (!result.ok) {
			return { content: result.error || "Failed to compact", isError: true };
		}

		return { content: `Session ${sessionId} compacted successfully.` };
	},
};
