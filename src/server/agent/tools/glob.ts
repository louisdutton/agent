// Glob file search tool

import { isAbsolute, join, relative } from "node:path";
import { Glob } from "bun";
import type { Tool, ToolContext, ToolResult } from "../types";

type GlobInput = {
	pattern: string;
	path?: string;
};

const MAX_RESULTS = 500;

export const globTool: Tool = {
	name: "glob",
	description:
		"Find files matching a glob pattern. Returns relative paths sorted by modification time.",
	inputSchema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')",
			},
			path: {
				type: "string",
				description: "Directory to search in (default: working directory)",
			},
		},
		required: ["pattern"],
	},
	requiresApproval: false,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { pattern, path } = input as GlobInput;

		if (!pattern || typeof pattern !== "string") {
			return { content: "Missing required parameter: pattern", isError: true };
		}

		const searchDir = path
			? isAbsolute(path)
				? path
				: join(ctx.workDir, path)
			: ctx.workDir;

		try {
			const glob = new Glob(pattern);
			const matches: { path: string; mtime: number }[] = [];

			for await (const file of glob.scan({ cwd: searchDir, absolute: true })) {
				try {
					const stat = await Bun.file(file).stat();
					matches.push({ path: file, mtime: stat?.mtime?.getTime() ?? 0 });
				} catch {
					matches.push({ path: file, mtime: 0 });
				}

				if (matches.length >= MAX_RESULTS) break;
			}

			// Sort by mtime descending (most recent first)
			matches.sort((a, b) => b.mtime - a.mtime);

			const relativePaths = matches.map((m) => relative(ctx.workDir, m.path));

			if (relativePaths.length === 0) {
				return { content: "No files found matching pattern" };
			}

			return { content: relativePaths.join("\n") };
		} catch (err) {
			return { content: `Error searching files: ${err}`, isError: true };
		}
	},
};
