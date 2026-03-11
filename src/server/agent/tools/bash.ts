// Bash command execution tool

import type { Tool, ToolContext, ToolResult } from "../types";

type BashInput = {
	command: string;
	timeout?: number;
};

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT = 50_000; // characters

export const bashTool: Tool = {
	name: "bash",
	description:
		"Execute a bash command and return the output. Use for git, npm, and other CLI operations.",
	inputSchema: {
		type: "object",
		properties: {
			command: { type: "string", description: "The bash command to execute" },
			timeout: {
				type: "number",
				description: "Timeout in milliseconds (default 120000)",
			},
		},
		required: ["command"],
	},
	requiresApproval: true,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { command, timeout = DEFAULT_TIMEOUT } = input as BashInput;

		try {
			const proc = Bun.spawn(["bash", "-c", command], {
				cwd: ctx.workDir,
				stdout: "pipe",
				stderr: "pipe",
			});

			// Set up timeout
			const timeoutId = setTimeout(() => proc.kill(), timeout);

			const [stdout, stderr] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);

			clearTimeout(timeoutId);
			const exitCode = await proc.exited;

			let output = stdout;
			if (stderr) {
				output += (output ? "\n" : "") + `stderr:\n${stderr}`;
			}

			// Truncate if too long
			if (output.length > MAX_OUTPUT) {
				output = output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
			}

			if (exitCode !== 0) {
				return {
					content: output || `Command failed with exit code ${exitCode}`,
					isError: true,
				};
			}

			return { content: output || "(no output)" };
		} catch (err) {
			return { content: `Error executing command: ${err}`, isError: true };
		}
	},
};
