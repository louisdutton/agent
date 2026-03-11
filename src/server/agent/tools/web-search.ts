// Web search tool using ddgr (DuckDuckGo CLI)

import type { Tool, ToolContext, ToolResult } from "../types";

type WebSearchInput = {
	query: string;
	num?: number; // Number of results (default 10, max 25)
};

type SearchResult = {
	title: string;
	url: string;
	abstract: string;
};

const MAX_RESULTS = 10;

export const webSearchTool: Tool = {
	name: "web_search",
	description:
		"Search the web using DuckDuckGo. Returns titles, URLs, and snippets for each result.",
	inputSchema: {
		type: "object",
		properties: {
			query: { type: "string", description: "The search query" },
			num: {
				type: "number",
				description: "Number of results to return (default 10, max 25)",
			},
		},
		required: ["query"],
	},
	requiresApproval: false,

	async execute(input: unknown, ctx: ToolContext): Promise<ToolResult> {
		const { query, num } = input as WebSearchInput;

		if (!query?.trim()) {
			return { content: "Missing 'query' argument", isError: true };
		}

		let numResults = num ?? MAX_RESULTS;
		if (numResults > 25) numResults = 25;
		if (numResults < 1) numResults = 1;

		try {
			const proc = Bun.spawn(
				["ddgr", "--json", "-n", String(numResults), query],
				{
					cwd: ctx.workDir,
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			const stdout = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;

			if (exitCode !== 0) {
				const stderr = await new Response(proc.stderr).text();
				return {
					content: `Search failed: ${stderr || "ddgr returned non-zero exit code"}`,
					isError: true,
				};
			}

			// Parse JSON results
			let results: SearchResult[];
			try {
				results = JSON.parse(stdout);
			} catch {
				return { content: "Failed to parse search results", isError: true };
			}

			if (!Array.isArray(results) || results.length === 0) {
				return { content: "No results found" };
			}

			// Format results
			const formatted = results
				.map((r, i) => {
					let entry = `${i + 1}. ${r.title}\n   ${r.url}`;
					if (r.abstract) {
						entry += `\n   ${r.abstract}`;
					}
					return entry;
				})
				.join("\n\n");

			return { content: formatted };
		} catch (err) {
			return {
				content: `Failed to execute search (is ddgr installed?): ${err}`,
				isError: true,
			};
		}
	},
};
