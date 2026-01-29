export type DiffLineType = "context" | "addition" | "deletion";

export type DiffLine = {
	type: DiffLineType;
	content: string;
	oldLineNum?: number;
	newLineNum?: number;
};

export type DiffHunk = { header: string; lines: DiffLine[] };

export type DiffFile = {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed";
	hunks: DiffHunk[];
};

// Simple LCS-based diff algorithm
export function computeDiff(
	oldLines: string[],
	newLines: string[],
): DiffLine[] {
	const result: DiffLine[] = [];

	// Build LCS table
	const m = oldLines.length;
	const n = newLines.length;
	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (oldLines[i - 1] === newLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to find diff
	let i = m;
	let j = n;
	const ops: {
		type: DiffLineType;
		content: string;
		oldIdx?: number;
		newIdx?: number;
	}[] = [];

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
			ops.unshift({
				type: "context",
				content: oldLines[i - 1],
				oldIdx: i,
				newIdx: j,
			});
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			ops.unshift({ type: "addition", content: newLines[j - 1], newIdx: j });
			j--;
		} else {
			ops.unshift({ type: "deletion", content: oldLines[i - 1], oldIdx: i });
			i--;
		}
	}

	// Convert to DiffLine format
	for (const op of ops) {
		result.push({
			type: op.type,
			content: op.content,
			oldLineNum: op.oldIdx,
			newLineNum: op.newIdx,
		});
	}

	return result;
}
