import { join } from "node:path";
import { $ } from "bun";
import { getCwd } from "./session";

// Git diff types
type DiffLineType = "context" | "addition" | "deletion";
type DiffLine = {
	type: DiffLineType;
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
};
type DiffHunk = { header: string; lines: DiffLine[] };
type DiffFile = {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed";
	hunks: DiffHunk[];
};

export async function getGitFiles() {
	const cwd = getCwd();
	$.cwd(cwd);

	const diff = await $`git diff`.text();
	const diffFiles = parseDiff(diff);

	const untrackedOutput =
		await $`git ls-files --others --exclude-standard`.text();
	const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean);

	const untrackedDiffs = await Promise.all(
		untrackedFiles.map(async (filePath) => {
			try {
				const file = Bun.file(join(cwd, filePath));
				if (await file.exists()) {
					const content = await file.text();
					const lines = content.split("\n");
					return {
						path: filePath,
						status: "added" as const,
						hunks: [
							{
								header: `@@ -0,0 +1,${lines.length} @@`,
								lines: lines.map((line, i) => ({
									type: "addition" as const,
									content: line,
									newLineNum: i + 1,
								})),
							},
						],
					};
				}
			} catch {
				// Skip files we can't read
			}
			return null;
		}),
	);
	diffFiles.push(...(untrackedDiffs.filter((d) => d !== null) as DiffFile[]));
}

// Parse git diff output into structured format
export function parseDiff(rawDiff: string): DiffFile[] {
	const files: DiffFile[] = [];
	const fileChunks = rawDiff.split(/^diff --git /m).filter(Boolean);

	for (const chunk of fileChunks) {
		const lines = chunk.split("\n");
		const pathMatch = lines[0]?.match(/a\/(.+) b\/(.+)/);
		if (!pathMatch) continue;

		const file: DiffFile = {
			path: pathMatch[2],
			status: "modified",
			hunks: [],
		};

		// Detect status from header
		if (lines.some((l) => l.startsWith("new file"))) file.status = "added";
		if (lines.some((l) => l.startsWith("deleted file")))
			file.status = "deleted";
		if (lines.some((l) => l.startsWith("rename"))) file.status = "renamed";

		// Parse hunks
		let currentHunk: DiffHunk | null = null;
		let oldLineNum = 0;
		let newLineNum = 0;

		for (const line of lines) {
			if (line.startsWith("@@")) {
				const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
				if (match) {
					oldLineNum = Number.parseInt(match[1], 10);
					newLineNum = Number.parseInt(match[2], 10);
					currentHunk = { header: line, lines: [] };
					file.hunks.push(currentHunk);
				}
			} else if (
				currentHunk &&
				(line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))
			) {
				const type: DiffLineType =
					line[0] === "+"
						? "addition"
						: line[0] === "-"
							? "deletion"
							: "context";
				currentHunk.lines.push({
					type,
					content: line.slice(1),
					oldLineNum: type !== "addition" ? oldLineNum++ : undefined,
					newLineNum: type !== "deletion" ? newLineNum++ : undefined,
				});
			}
		}

		files.push(file);
	}

	return files;
}
