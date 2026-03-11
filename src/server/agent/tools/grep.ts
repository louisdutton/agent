// Grep content search tool

import { isAbsolute, join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types";

type GrepInput = {
	pattern: string;
	path?: string;
	glob?: string;
};

const MAX_MATCHES = 100;

export const grepTool: Tool = {
	name: "grep",
	description:
		"Search for a pattern in files using ripgrep. Returns matching file paths by default.",
	inputSchema: {
		type: "object",
		properties: {
			pattern: { type: "string", description: "Regex pattern to search for" },
			path: { type: "string", description: "File or directory to search in" },
			glob: {
				type: "string",
				description: "Glob pattern to filter files (e.g., '*.ts')",
			},
		},
		required: ["pattern"],
	},
	requiresApproval: false,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { pattern, path, glob } = input as GrepInput;
		const searchPath = path
			? isAbsolute(path)
				? path
				: join(ctx.workDir, path)
			: ctx.workDir;

		try {
			const args = [
				"rg",
				"--files-with-matches",
				"--max-count",
				"1",
				"-e",
				pattern,
			];

			if (glob) {
				args.push("--glob", glob);
			}

			args.push(searchPath);

			const proc = Bun.spawn(args, {
				cwd: ctx.workDir,
				stdout: "pipe",
				stderr: "pipe",
			});

			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;

			// rg returns 1 when no matches, 2 for errors
			if (exitCode === 1) {
				return { content: "No matches found" };
			}
			if (exitCode !== 0) {
				const stderr = await new Response(proc.stderr).text();
				return { content: `Search failed: ${stderr}`, isError: true };
			}

			const lines = stdout.trim().split("\n").filter(Boolean);
			if (lines.length > MAX_MATCHES) {
				return {
					content:
						lines.slice(0, MAX_MATCHES).join("\n") +
						`\n... and ${lines.length - MAX_MATCHES} more files`,
				};
			}

			return { content: lines.join("\n") || "No matches found" };
		} catch (err) {
			return { content: `Error searching: ${err}`, isError: true };
		}
	},
};
