// Write file tool

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types";

type WriteInput = {
	path: string;
	content: string;
};

export const writeTool: Tool = {
	name: "write",
	description:
		"Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
	inputSchema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Path to the file to write" },
			content: { type: "string", description: "Content to write to the file" },
		},
		required: ["path", "content"],
	},
	requiresApproval: false,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { path, content } = input as WriteInput;
		const fullPath = isAbsolute(path) ? path : join(ctx.workDir, path);

		try {
			// Ensure directory exists
			await mkdir(dirname(fullPath), { recursive: true });

			await Bun.write(fullPath, content);
			const lines = content.split("\n").length;
			return { content: `Wrote ${lines} lines to ${path}` };
		} catch (err) {
			return { content: `Error writing file: ${err}`, isError: true };
		}
	},
};
