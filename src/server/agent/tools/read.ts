// Read file tool

import { isAbsolute, join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types";

type ReadInput = {
	path: string;
	offset?: number;
	limit?: number;
};

export const readTool: Tool = {
	name: "read",
	description:
		"Read the contents of a file. Returns the file content with line numbers.",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description:
					"Path to the file to read (absolute or relative to working directory)",
			},
			offset: {
				type: "number",
				description: "Line number to start reading from (1-indexed)",
			},
			limit: { type: "number", description: "Maximum number of lines to read" },
		},
		required: ["path"],
	},
	requiresApproval: false,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { path, offset, limit } = input as ReadInput;

		if (!path || typeof path !== "string") {
			return { content: "Missing required parameter: path", isError: true };
		}

		const fullPath = isAbsolute(path) ? path : join(ctx.workDir, path);

		try {
			const file = Bun.file(fullPath);
			if (!(await file.exists())) {
				return { content: `File not found: ${path}`, isError: true };
			}

			const text = await file.text();
			const lines = text.split("\n");

			const startLine = Math.max(0, (offset ?? 1) - 1);
			const endLine = limit ? startLine + limit : lines.length;
			const selectedLines = lines.slice(startLine, endLine);

			// Format with line numbers
			const numbered = selectedLines
				.map((line, i) => `${String(startLine + i + 1).padStart(6)}│ ${line}`)
				.join("\n");

			return { content: numbered };
		} catch (err) {
			return { content: `Error reading file: ${err}`, isError: true };
		}
	},
};
