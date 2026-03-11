// Config management tools - allow assistant to view and update configuration

import { type AgentConfig, getConfig, updateConfig } from "../../config";
import type { Tool, ToolResult } from "../types";

export const getConfigTool: Tool = {
	name: "get_config",
	description:
		"Get the current agent configuration including model, auto-approve tools, and session limits.",
	inputSchema: {
		type: "object",
		properties: {},
	},
	requiresApproval: false,
	execute: async (): Promise<ToolResult> => {
		const config = await getConfig();
		return {
			content: JSON.stringify(config, null, 2),
		};
	},
};

export const updateConfigTool: Tool = {
	name: "update_config",
	description:
		"Update agent configuration. Available settings: model (AI model to use), autoApproveTools (array of tool names that don't require approval), maxConcurrentSessions (max parallel sessions).",
	inputSchema: {
		type: "object",
		properties: {
			model: {
				type: "string",
				description: "AI model to use (e.g., 'claude-sonnet-4-20250514')",
			},
			autoApproveTools: {
				type: "array",
				items: { type: "string" },
				description:
					"Tools that don't require approval (e.g., ['Read', 'Glob', 'Grep'])",
			},
			maxConcurrentSessions: {
				type: "number",
				description: "Maximum number of parallel sessions",
			},
		},
	},
	requiresApproval: true,
	execute: async (input: unknown): Promise<ToolResult> => {
		const partial = input as Partial<AgentConfig>;

		// Validate
		if (partial.maxConcurrentSessions !== undefined) {
			if (
				partial.maxConcurrentSessions < 1 ||
				partial.maxConcurrentSessions > 20
			) {
				return {
					content: "maxConcurrentSessions must be between 1 and 20",
					isError: true,
				};
			}
		}

		const config = await updateConfig(partial);
		return {
			content: `Config updated:\n${JSON.stringify(config, null, 2)}`,
		};
	},
};
