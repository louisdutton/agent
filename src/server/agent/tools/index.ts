// Tool registry

import type { Tool, ToolContext, ToolResult } from "../types";
import {
	createJobTool,
	createWebhookTool,
	deleteAutomationTool,
	listAutomationsTool,
	runJobNowTool,
	toggleAutomationTool,
} from "./automations";
import { bashTool } from "./bash";
import { getConfigTool, updateConfigTool } from "./config";
import { globTool } from "./glob";
import { grepTool } from "./grep";
import { readTool } from "./read";
import { webSearchTool } from "./web-search";
import { writeTool } from "./write";

export class ToolRegistry {
	private tools = new Map<string, Tool>();

	register(tool: Tool): void {
		this.tools.set(tool.name, tool);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	list(): Tool[] {
		return Array.from(this.tools.values());
	}

	async execute(
		name: string,
		input: unknown,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const tool = this.tools.get(name);
		if (!tool) {
			return { content: `Unknown tool: ${name}`, isError: true };
		}
		return tool.execute(input, ctx);
	}
}

// Create default registry with built-in tools
export function createDefaultToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();

	// Core tools
	registry.register(readTool);
	registry.register(writeTool);
	registry.register(bashTool);
	registry.register(globTool);
	registry.register(grepTool);
	registry.register(webSearchTool);

	// Automation tools
	registry.register(listAutomationsTool);
	registry.register(createJobTool);
	registry.register(createWebhookTool);
	registry.register(toggleAutomationTool);
	registry.register(deleteAutomationTool);
	registry.register(runJobNowTool);

	// Config tools
	registry.register(getConfigTool);
	registry.register(updateConfigTool);

	// Session tools
	registry.register(listActiveSessionsTool);
	registry.register(listSessionHistoryTool);
	registry.register(viewSessionTool);
	registry.register(cancelSessionTool);
	registry.register(deleteSessionTool);
	registry.register(compactSessionTool);

	return registry;
}

export { bashTool, globTool, grepTool, readTool, webSearchTool, writeTool };
export {
	createJobTool,
	createWebhookTool,
	deleteAutomationTool,
	listAutomationsTool,
	runJobNowTool,
	toggleAutomationTool,
};
export { getConfigTool, updateConfigTool };
