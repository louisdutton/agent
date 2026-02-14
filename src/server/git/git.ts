import { $ } from "bun";
import { getCwd } from "../session";

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

// Commit log types
export type GitCommit = {
	hash: string;
	shortHash: string;
	author: string;
	email: string;
	date: string;
	relativeDate: string;
	subject: string;
	body: string;
	refs: string[];
	parents: string[];
};

export type GitBranch = {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	lastCommit?: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
};

export type GitStash = {
	index: number;
	message: string;
	branch: string;
	date: string;
};

export type CommitFile = {
	path: string;
	status: "A" | "M" | "D" | "R" | "C" | "U";
	additions: number;
	deletions: number;
};

export async function getGitFiles() {
	const cwd = getCwd();
	$.cwd(cwd);

	await $`git add -N .`; // include untracked files
	const diff = await $`git diff`.text();
	return parseDiff(diff);
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

// Get commit log with graph info
export async function getGitLog(
	count = 50,
	branch?: string,
): Promise<GitCommit[]> {
	const cwd = getCwd();
	$.cwd(cwd);

	// Custom format: hash, short hash, author, email, date, relative date, subject, body, refs, parents
	const format =
		"%H%x00%h%x00%an%x00%ae%x00%aI%x00%ar%x00%s%x00%b%x00%D%x00%P%x00";
	const args = ["log", `--format=${format}`, `-n`, count.toString(), "--all"];
	if (branch) args.push(branch);

	const output = await $`git ${args}`.text();
	const commits: GitCommit[] = [];

	for (const entry of output.split("%x00\n").filter(Boolean)) {
		const parts = entry.split("\x00");
		if (parts.length < 9) continue;

		const refs = parts[8] ? parts[8].split(", ").filter(Boolean) : [];
		const parents = parts[9] ? parts[9].trim().split(" ").filter(Boolean) : [];

		commits.push({
			hash: parts[0],
			shortHash: parts[1],
			author: parts[2],
			email: parts[3],
			date: parts[4],
			relativeDate: parts[5],
			subject: parts[6],
			body: parts[7]?.trim() || "",
			refs,
			parents,
		});
	}

	return commits;
}

// Get current branch name
export async function getCurrentBranch(): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const branch = await $`git rev-parse --abbrev-ref HEAD`.text();
	return branch.trim();
}

// Get all branches
export async function getBranches(): Promise<GitBranch[]> {
	const cwd = getCwd();
	$.cwd(cwd);

	// Format: refname, objectname:short, upstream, upstream:track
	const format =
		"%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)";
	const output =
		await $`git for-each-ref --format=${format} refs/heads refs/remotes`.text();
	const branches: GitBranch[] = [];

	for (const line of output.trim().split("\n").filter(Boolean)) {
		const [name, lastCommit, upstream, track, head] = line.split("\x00");
		if (!name) continue;

		const isRemote = name.startsWith("origin/") || name.includes("/");
		// Skip HEAD references
		if (name === "origin/HEAD") continue;

		let ahead = 0;
		let behind = 0;
		if (track) {
			const aheadMatch = track.match(/ahead (\d+)/);
			const behindMatch = track.match(/behind (\d+)/);
			if (aheadMatch) ahead = Number.parseInt(aheadMatch[1], 10);
			if (behindMatch) behind = Number.parseInt(behindMatch[1], 10);
		}

		branches.push({
			name: isRemote ? name.replace("origin/", "") : name,
			isCurrent: head === "*",
			isRemote,
			lastCommit,
			upstream: upstream || undefined,
			ahead,
			behind,
		});
	}

	// Dedupe and merge local/remote info
	const branchMap = new Map<string, GitBranch>();
	for (const b of branches) {
		const existing = branchMap.get(b.name);
		if (existing) {
			// Prefer local branch info
			if (!b.isRemote) {
				branchMap.set(b.name, b);
			}
		} else {
			branchMap.set(b.name, b);
		}
	}

	return Array.from(branchMap.values()).sort((a, b) => {
		if (a.isCurrent) return -1;
		if (b.isCurrent) return 1;
		return a.name.localeCompare(b.name);
	});
}

// Switch to branch
export async function switchBranch(branchName: string): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	await $`git checkout ${branchName}`;
}

// Create new branch
export async function createBranch(
	branchName: string,
	startPoint?: string,
): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	if (startPoint) {
		await $`git checkout -b ${branchName} ${startPoint}`;
	} else {
		await $`git checkout -b ${branchName}`;
	}
}

// Delete branch
export async function deleteBranch(
	branchName: string,
	force = false,
): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	if (force) {
		await $`git branch -D ${branchName}`;
	} else {
		await $`git branch -d ${branchName}`;
	}
}

// Merge branch
export async function mergeBranch(branchName: string): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const result = await $`git merge ${branchName}`.text();
	return result;
}

// Get commit details with diff
export async function getCommitDetails(
	hash: string,
): Promise<{ commit: GitCommit; files: CommitFile[]; diff: DiffFile[] }> {
	const cwd = getCwd();
	$.cwd(cwd);

	// Get commit info
	const format = "%H%x00%h%x00%an%x00%ae%x00%aI%x00%ar%x00%s%x00%b%x00%D%x00%P";
	const commitOutput = await $`git show --format=${format} -s ${hash}`.text();
	const parts = commitOutput.split("\x00");

	const commit: GitCommit = {
		hash: parts[0],
		shortHash: parts[1],
		author: parts[2],
		email: parts[3],
		date: parts[4],
		relativeDate: parts[5],
		subject: parts[6],
		body: parts[7]?.trim() || "",
		refs: parts[8] ? parts[8].split(", ").filter(Boolean) : [],
		parents: parts[9] ? parts[9].trim().split(" ").filter(Boolean) : [],
	};

	// Get files changed with stats
	const filesOutput = await $`git show --numstat --format="" ${hash}`.text();
	const files: CommitFile[] = [];

	for (const line of filesOutput.trim().split("\n").filter(Boolean)) {
		const [additions, deletions, path] = line.split("\t");
		if (!path) continue;

		// Determine status from diff
		const addNum = additions === "-" ? 0 : Number.parseInt(additions, 10);
		const delNum = deletions === "-" ? 0 : Number.parseInt(deletions, 10);

		let status: CommitFile["status"] = "M";
		if (addNum > 0 && delNum === 0) status = "A";
		if (addNum === 0 && delNum > 0) status = "D";

		files.push({
			path,
			status,
			additions: addNum,
			deletions: delNum,
		});
	}

	// Get full diff
	const diffOutput = await $`git show --format="" ${hash}`.text();
	const diff = parseDiff(diffOutput);

	return { commit, files, diff };
}

// Get stash list
export async function getStashes(): Promise<GitStash[]> {
	const cwd = getCwd();
	$.cwd(cwd);

	const output = await $`git stash list --format=%gd%x00%s%x00%ar`.text();
	const stashes: GitStash[] = [];

	for (const line of output.trim().split("\n").filter(Boolean)) {
		const [ref, message, date] = line.split("\x00");
		const indexMatch = ref?.match(/stash@\{(\d+)\}/);
		if (!indexMatch) continue;

		const branchMatch = message?.match(/^WIP on (\S+):|^On (\S+):/);
		const branch = branchMatch?.[1] || branchMatch?.[2] || "";

		stashes.push({
			index: Number.parseInt(indexMatch[1], 10),
			message: message || "",
			branch,
			date: date || "",
		});
	}

	return stashes;
}

// Stash changes
export async function stashSave(message?: string): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	if (message) {
		await $`git stash push -m ${message}`;
	} else {
		await $`git stash push`;
	}
}

// Pop stash
export async function stashPop(index = 0): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	await $`git stash pop stash@{${index}}`;
}

// Apply stash (without removing)
export async function stashApply(index = 0): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	await $`git stash apply stash@{${index}}`;
}

// Drop stash
export async function stashDrop(index: number): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	await $`git stash drop stash@{${index}}`;
}

// Pull from remote
export async function gitPull(): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const result = await $`git pull`.text();
	return result;
}

// Push to remote
export async function gitPush(
	force = false,
	setUpstream = false,
): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const args = ["push"];
	if (force) args.push("--force-with-lease");
	if (setUpstream) {
		const branch = await getCurrentBranch();
		args.push("-u", "origin", branch);
	}
	const result = await $`git ${args}`.text();
	return result;
}

// Fetch from remote
export async function gitFetch(): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const result = await $`git fetch --all --prune`.text();
	return result;
}

// Reset to commit
export async function gitReset(
	hash: string,
	mode: "soft" | "mixed" | "hard" = "mixed",
): Promise<void> {
	const cwd = getCwd();
	$.cwd(cwd);
	await $`git reset --${mode} ${hash}`;
}

// Cherry-pick commit
export async function gitCherryPick(hash: string): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const result = await $`git cherry-pick ${hash}`.text();
	return result;
}

// Revert commit
export async function gitRevert(hash: string): Promise<string> {
	const cwd = getCwd();
	$.cwd(cwd);
	const result = await $`git revert --no-edit ${hash}`.text();
	return result;
}
