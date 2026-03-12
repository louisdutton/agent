// Spawn task tool - allows assistant to create new tasks with context

import { getAssistantManager } from "../../assistant";
import { getSessionManager } from "../session-manager";
import type { Tool, ToolContext, ToolResult } from "../types";

type SpawnTaskInput = {
	prompt: string;
	project?: string;
	contextTags?: string[];
};

export const spawnTaskTool: Tool = {
	name: "spawn_task",
	description:
		"Create a new task session with specific context. The task will run in its own session with relevant memory injected. Use this for discrete work units that can run independently.",
	inputSchema: {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description: "The task prompt/instructions",
			},
			project: {
				type: "string",
				description:
					"Project path for the task. Defaults to current project if not specified.",
			},
			contextTags: {
				type: "array",
				items: { type: "string" },
				description: "Memory tags to include for context (optional)",
			},
		},
		required: ["prompt"],
	},
	requiresApproval: false,
	execute: async (input: unknown, ctx: ToolContext): Promise<ToolResult> => {
		const { prompt, project, contextTags } = input as SpawnTaskInput;
		const projectPath = project || ctx.workDir;

		try {
			const assistant = getAssistantManager();
			const sessionManager = getSessionManager();

			// Build context with relevant memory
			const taskContext = await assistant.buildTaskContext(prompt, {
				tags: contextTags,
				parentTaskId: ctx.sessionId,
				spawnedBy: "assistant",
			});

			// Create a new session for the task
			const session = sessionManager.create(projectPath);
			session.context = taskContext;
			session.title = prompt.slice(0, 50) + (prompt.length > 50 ? "..." : "");

			// Send the initial message to start the task
			// Note: this runs in the background
			sessionManager.sendMessage(session.id, prompt).catch((err) => {
				console.error(`Task ${session.id} failed:`, err);
			});

			return {
				content: JSON.stringify(
					{
						taskId: session.id,
						status: "running",
						project: projectPath,
						memoryInjected: taskContext.memory.length,
					},
					null,
					2,
				),
			};
		} catch (err) {
			return {
				content: `Failed to spawn task: ${err}`,
				isError: true,
			};
		}
	},
};
