import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { DiffFile } from "./diff";
import { hljs } from "./hljs";

// Types matching server
type GitCommit = {
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

type GitBranch = {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
	lastCommit?: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
};

type GitStash = {
	index: number;
	message: string;
	branch: string;
	date: string;
};

type CommitFile = {
	path: string;
	status: "A" | "M" | "D" | "R" | "C" | "U";
	additions: number;
	deletions: number;
};

type Tab = "log" | "branches" | "stashes";

// Map file extensions to highlight.js language identifiers
function getLanguageFromPath(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() || "";
	const extMap: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		py: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
		java: "java",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		md: "markdown",
		css: "css",
		html: "xml",
		sh: "bash",
	};
	return extMap[ext] || "";
}

function highlightCodeSync(code: string, lang: string): string[] {
	try {
		const lines = code.split("\n");
		return lines.map((line) => {
			if (!line.trim()) return line || " ";
			let result: ReturnType<typeof hljs.highlight>;
			if (lang && hljs.getLanguage(lang)) {
				result = hljs.highlight(line, { language: lang, ignoreIllegals: true });
			} else {
				result = hljs.highlightAuto(line);
			}
			return result.value || line || " ";
		});
	} catch {
		return code.split("\n").map((line) => line || " ");
	}
}

// Large touch-friendly commit row
function CommitRow(props: {
	commit: GitCommit;
	isSelected: boolean;
	onClick: () => void;
}) {
	const branchRefs = createMemo(() =>
		props.commit.refs.filter((r) => !r.startsWith("tag:") && r !== "HEAD"),
	);
	const tagRefs = createMemo(() =>
		props.commit.refs
			.filter((r) => r.startsWith("tag:"))
			.map((r) => r.replace("tag: ", "")),
	);
	const isHead = createMemo(() => props.commit.refs.some((r) => r === "HEAD"));

	return (
		<button
			type="button"
			onClick={props.onClick}
			class="w-full flex items-start gap-4 px-4 py-4 active:bg-muted/70 transition-colors text-left border-b border-border/50 min-h-[72px]"
			classList={{ "bg-muted/50": props.isSelected }}
		>
			{/* Graph indicator - larger for touch */}
			<div class="w-8 flex items-center justify-center shrink-0 pt-1">
				<div
					class="w-4 h-4 rounded-full"
					classList={{
						"bg-foreground": isHead(),
						"bg-muted-foreground": branchRefs().length > 0 && !isHead(),
						"bg-muted-foreground/50": branchRefs().length === 0 && !isHead(),
					}}
				/>
			</div>

			{/* Commit info */}
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2 flex-wrap mb-1">
					<span class="font-mono text-sm text-muted-foreground">
						{props.commit.shortHash}
					</span>
					<For each={branchRefs()}>
						{(ref) => (
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-foreground">
								{ref.replace("HEAD -> ", "")}
							</span>
						)}
					</For>
					<For each={tagRefs()}>
						{(tag) => (
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground">
								{tag}
							</span>
						)}
					</For>
				</div>
				<div class="text-base leading-snug line-clamp-2">
					{props.commit.subject}
				</div>
				<div class="flex items-center gap-2 text-sm text-muted-foreground mt-1">
					<span>{props.commit.author}</span>
					<span>·</span>
					<span>{props.commit.relativeDate}</span>
				</div>
			</div>

			{/* Chevron indicator */}
			<div class="shrink-0 pt-1">
				<svg
					class="w-5 h-5 text-muted-foreground"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 5l7 7-7 7"
					/>
				</svg>
			</div>
		</button>
	);
}

// Commit detail view with bottom action bar
function CommitDetail(props: {
	hash: string;
	onClose: () => void;
	onAction: (action: string, hash: string) => void;
}) {
	const [loading, setLoading] = createSignal(true);
	const [commit, setCommit] = createSignal<GitCommit | null>(null);
	const [files, setFiles] = createSignal<CommitFile[]>([]);
	const [diff, setDiff] = createSignal<DiffFile[]>([]);
	const [showDiff, setShowDiff] = createSignal(false);
	const [expandedFiles, setExpandedFiles] = createSignal<Set<string>>(
		new Set(),
	);

	onMount(async () => {
		try {
			const res = await fetch(`/api/git/commits/${props.hash}`);
			if (res.ok) {
				const data = await res.json();
				setCommit(data.commit);
				setFiles(data.files);
				setDiff(data.diff);
			}
		} catch (err) {
			console.error("Failed to load commit:", err);
		} finally {
			setLoading(false);
		}
	});

	const toggleFile = (path: string) => {
		const newSet = new Set(expandedFiles());
		if (newSet.has(path)) {
			newSet.delete(path);
		} else {
			newSet.add(path);
		}
		setExpandedFiles(newSet);
	};

	const getDiffForFile = (path: string) => {
		return diff().find((d) => d.path === path);
	};

	return (
		<div class="h-full flex flex-col">
			{/* Scrollable content */}
			<div class="flex-1 overflow-y-auto pb-24">
				<Show when={loading()}>
					<div class="flex items-center justify-center h-32">
						<span class="text-muted-foreground">Loading...</span>
					</div>
				</Show>

				<Show when={!loading() && commit()}>
					{/* Commit info */}
					<div class="p-4 border-b border-border">
						<div class="flex items-center gap-2 mb-2">
							<span class="font-mono text-sm text-muted-foreground bg-muted px-2 py-1 rounded">
								{commit()?.shortHash}
							</span>
						</div>
						<h2 class="text-lg font-medium leading-snug">
							{commit()?.subject}
						</h2>
						<Show when={commit()?.body}>
							<p class="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">
								{commit()?.body}
							</p>
						</Show>
						<div class="flex items-center gap-3 mt-4 text-sm text-muted-foreground">
							<span>{commit()?.author}</span>
							<span>·</span>
							<span>{commit()?.relativeDate}</span>
						</div>
					</div>

					{/* Files changed */}
					<div class="p-4">
						<div class="flex items-center justify-between mb-3">
							<h3 class="text-base font-medium">
								{files().length} file{files().length !== 1 ? "s" : ""} changed
							</h3>
							<button
								type="button"
								onClick={() => setShowDiff(!showDiff())}
								class="text-sm text-muted-foreground px-3 py-1.5 rounded-lg active:bg-muted"
							>
								{showDiff() ? "Hide diff" : "Show diff"}
							</button>
						</div>

						<div class="space-y-2">
							<For each={files()}>
								{(file) => (
									<div class="border border-border rounded-lg overflow-hidden">
										<button
											type="button"
											onClick={() => toggleFile(file.path)}
											class="w-full flex items-center gap-3 px-4 py-3 active:bg-muted/50 text-left min-h-[52px]"
										>
											<span
												class="text-sm font-mono font-bold w-5"
												classList={{
													"text-green-500": file.status === "A",
													"text-foreground": file.status === "M",
													"text-red-500": file.status === "D",
													"text-muted-foreground": file.status === "R",
												}}
											>
												{file.status}
											</span>
											<span class="flex-1 font-mono text-sm truncate">
												{file.path}
											</span>
											<span class="text-sm text-muted-foreground shrink-0">
												<span class="text-green-500">+{file.additions}</span>
												<span class="mx-1">/</span>
												<span class="text-red-500">-{file.deletions}</span>
											</span>
										</button>

										<Show when={showDiff() && expandedFiles().has(file.path)}>
											<DiffView diff={getDiffForFile(file.path)} />
										</Show>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>

			{/* Fixed bottom action bar */}
			<div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 pb-6 safe-area-inset-bottom">
				<div class="flex items-center gap-3">
					<button
						type="button"
						onClick={props.onClose}
						class="flex-1 h-12 text-base rounded-xl border border-border active:bg-muted"
					>
						Back
					</button>
					<button
						type="button"
						onClick={() => props.onAction("cherry-pick", props.hash)}
						class="flex-1 h-12 text-base rounded-xl bg-muted active:bg-muted/70"
					>
						Cherry-pick
					</button>
					<button
						type="button"
						onClick={() => props.onAction("revert", props.hash)}
						class="flex-1 h-12 text-base rounded-xl bg-muted active:bg-muted/70"
					>
						Revert
					</button>
				</div>
				<div class="flex items-center gap-3 mt-3">
					<button
						type="button"
						onClick={() => props.onAction("reset-soft", props.hash)}
						class="flex-1 h-12 text-base rounded-xl bg-muted active:bg-muted/70"
					>
						Reset soft
					</button>
					<button
						type="button"
						onClick={() => props.onAction("reset-hard", props.hash)}
						class="flex-1 h-12 text-base rounded-xl bg-red-500/20 text-red-400 active:bg-red-500/30"
					>
						Reset hard
					</button>
				</div>
			</div>
		</div>
	);
}

// Inline diff viewer
function DiffView(props: { diff?: DiffFile }) {
	return (
		<Show when={props.diff}>
			<div class="border-t border-border overflow-x-auto">
				<For each={props.diff?.hunks}>
					{(hunk) => (
						<div>
							<div class="px-4 py-2 bg-muted text-muted-foreground font-mono text-sm">
								{hunk.header}
							</div>
							<For each={hunk.lines}>
								{(line) => {
									const lang = getLanguageFromPath(props.diff?.path || "");
									const highlighted = highlightCodeSync(line.content, lang)[0];
									return (
										<div
											class="flex font-mono text-sm"
											classList={{
												"bg-green-500/15": line.type === "addition",
												"bg-red-500/15": line.type === "deletion",
											}}
										>
											<span class="w-12 shrink-0 text-right px-2 text-muted-foreground/50 select-none border-r border-border">
												{line.oldLineNum ?? ""}
											</span>
											<span class="w-12 shrink-0 text-right px-2 text-muted-foreground/50 select-none border-r border-border">
												{line.newLineNum ?? ""}
											</span>
											<span
												class="w-6 shrink-0 text-center select-none"
												classList={{
													"text-green-500": line.type === "addition",
													"text-red-500": line.type === "deletion",
												}}
											>
												{line.type === "addition"
													? "+"
													: line.type === "deletion"
														? "-"
														: " "}
											</span>
											<pre
												class="px-2 whitespace-pre hljs"
												innerHTML={highlighted}
											/>
										</div>
									);
								}}
							</For>
						</div>
					)}
				</For>
			</div>
		</Show>
	);
}

// Large touch-friendly branch row
function BranchRow(props: {
	branch: GitBranch;
	onSwitch: () => void;
	onMerge: () => void;
	onDelete: () => void;
}) {
	return (
		<div
			class="flex items-center gap-3 px-4 py-4 border-b border-border/50 min-h-[72px]"
			classList={{ "bg-muted/30": props.branch.isCurrent }}
		>
			{/* Current indicator */}
			<div class="w-8 flex items-center justify-center shrink-0">
				<Show when={props.branch.isCurrent}>
					<svg
						class="w-6 h-6 text-foreground"
						fill="currentColor"
						viewBox="0 0 20 20"
					>
						<path
							fill-rule="evenodd"
							d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
							clip-rule="evenodd"
						/>
					</svg>
				</Show>
			</div>

			{/* Branch info */}
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2">
					<span class="font-mono text-base truncate">{props.branch.name}</span>
					<Show when={props.branch.isRemote}>
						<span class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
							remote
						</span>
					</Show>
				</div>
				<Show when={props.branch.ahead || props.branch.behind}>
					<div class="text-sm text-muted-foreground mt-1">
						<Show when={props.branch.ahead}>
							<span class="text-green-500">↑{props.branch.ahead}</span>
						</Show>
						<Show when={props.branch.ahead && props.branch.behind}> </Show>
						<Show when={props.branch.behind}>
							<span class="text-red-500">↓{props.branch.behind}</span>
						</Show>
					</div>
				</Show>
			</div>

			{/* Actions - only for non-current branches */}
			<Show when={!props.branch.isCurrent}>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onClick={props.onSwitch}
						class="w-11 h-11 rounded-xl bg-foreground text-background flex items-center justify-center active:opacity-80"
						title="Checkout"
					>
						<svg
							class="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M9 5l7 7-7 7"
							/>
						</svg>
					</button>
					<button
						type="button"
						onClick={props.onMerge}
						class="w-11 h-11 rounded-xl bg-muted flex items-center justify-center active:bg-muted/70"
						title="Merge"
					>
						<svg
							class="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M4 6h16M4 12h16m-7 6h7"
							/>
						</svg>
					</button>
					<button
						type="button"
						onClick={props.onDelete}
						class="w-11 h-11 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center active:bg-red-500/30"
						title="Delete"
					>
						<svg
							class="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
							/>
						</svg>
					</button>
				</div>
			</Show>
		</div>
	);
}

// Branch list with bottom create button
function BranchList(props: {
	onSwitch: (branch: string) => void;
	onMerge: (branch: string) => void;
	onDelete: (branch: string) => void;
	onCreate: () => void;
}) {
	const [branches, setBranches] = createSignal<GitBranch[]>([]);
	const [loading, setLoading] = createSignal(true);

	const loadBranches = async () => {
		try {
			const res = await fetch("/api/git/branches");
			if (res.ok) {
				const data = await res.json();
				setBranches(data.branches);
			}
		} catch (err) {
			console.error("Failed to load branches:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(loadBranches);

	return (
		<div class="h-full flex flex-col">
			<Show when={loading()}>
				<div class="flex-1 flex items-center justify-center">
					<span class="text-muted-foreground">Loading...</span>
				</div>
			</Show>

			<Show when={!loading()}>
				<div class="flex-1 overflow-y-auto pb-24">
					<For each={branches()}>
						{(branch) => (
							<BranchRow
								branch={branch}
								onSwitch={() => props.onSwitch(branch.name)}
								onMerge={() => props.onMerge(branch.name)}
								onDelete={() => props.onDelete(branch.name)}
							/>
						)}
					</For>
				</div>

				{/* Fixed bottom create button */}
				<div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 pb-6 safe-area-inset-bottom">
					<button
						type="button"
						onClick={props.onCreate}
						class="w-full h-14 text-base font-medium rounded-xl bg-foreground text-background active:opacity-80"
					>
						Create New Branch
					</button>
				</div>
			</Show>
		</div>
	);
}

// Large touch-friendly stash row
function StashRow(props: {
	stash: GitStash;
	onPop: () => void;
	onApply: () => void;
	onDrop: () => void;
}) {
	return (
		<div class="px-4 py-4 border-b border-border/50 min-h-[72px]">
			<div class="mb-3">
				<div class="text-base leading-snug line-clamp-2">
					{props.stash.message}
				</div>
				<div class="text-sm text-muted-foreground mt-1">
					{props.stash.branch} · {props.stash.date}
				</div>
			</div>

			<div class="flex items-center gap-2">
				<button
					type="button"
					onClick={props.onPop}
					class="flex-1 h-11 text-sm font-medium rounded-xl bg-foreground text-background active:opacity-80"
				>
					Pop
				</button>
				<button
					type="button"
					onClick={props.onApply}
					class="flex-1 h-11 text-sm font-medium rounded-xl bg-muted active:bg-muted/70"
				>
					Apply
				</button>
				<button
					type="button"
					onClick={props.onDrop}
					class="w-11 h-11 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center active:bg-red-500/30"
				>
					<svg
						class="w-5 h-5"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
			</div>
		</div>
	);
}

// Stash list with bottom save button
function StashList(props: {
	onPop: (index: number) => void;
	onApply: (index: number) => void;
	onDrop: (index: number) => void;
	onSave: () => void;
}) {
	const [stashes, setStashes] = createSignal<GitStash[]>([]);
	const [loading, setLoading] = createSignal(true);

	const loadStashes = async () => {
		try {
			const res = await fetch("/api/git/stashes");
			if (res.ok) {
				const data = await res.json();
				setStashes(data.stashes);
			}
		} catch (err) {
			console.error("Failed to load stashes:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(loadStashes);

	return (
		<div class="h-full flex flex-col">
			<Show when={loading()}>
				<div class="flex-1 flex items-center justify-center">
					<span class="text-muted-foreground">Loading...</span>
				</div>
			</Show>

			<Show when={!loading() && stashes().length === 0}>
				<div class="flex-1 flex items-center justify-center">
					<span class="text-muted-foreground text-lg">No stashes</span>
				</div>
			</Show>

			<Show when={!loading() && stashes().length > 0}>
				<div class="flex-1 overflow-y-auto pb-24">
					<For each={stashes()}>
						{(stash) => (
							<StashRow
								stash={stash}
								onPop={() => props.onPop(stash.index)}
								onApply={() => props.onApply(stash.index)}
								onDrop={() => props.onDrop(stash.index)}
							/>
						)}
					</For>
				</div>
			</Show>

			{/* Fixed bottom stash button */}
			<div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 pb-6 safe-area-inset-bottom">
				<button
					type="button"
					onClick={props.onSave}
					class="w-full h-14 text-base font-medium rounded-xl bg-foreground text-background active:opacity-80"
				>
					Stash Changes
				</button>
			</div>
		</div>
	);
}

// Bottom sheet style create branch dialog
function CreateBranchDialog(props: {
	onClose: () => void;
	onCreate: (name: string, startPoint?: string) => void;
}) {
	const [name, setName] = createSignal("");
	const [startPoint, setStartPoint] = createSignal("");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (name().trim()) {
			props.onCreate(name().trim(), startPoint().trim() || undefined);
		}
	};

	return (
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
			onClick={(e) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
		>
			<form
				onSubmit={handleSubmit}
				class="w-full bg-background border-t border-border rounded-t-2xl p-6 pb-8 safe-area-inset-bottom"
			>
				<div class="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-6" />

				<h3 class="text-xl font-medium mb-6">Create Branch</h3>

				<div class="space-y-4">
					<div>
						<label class="block text-sm text-muted-foreground mb-2">
							Branch name
						</label>
						<input
							type="text"
							value={name()}
							onInput={(e) => setName(e.currentTarget.value)}
							class="w-full px-4 py-3 bg-muted border border-border rounded-xl text-base"
							placeholder="feature/my-feature"
							autofocus
						/>
					</div>

					<div>
						<label class="block text-sm text-muted-foreground mb-2">
							Start from (optional)
						</label>
						<input
							type="text"
							value={startPoint()}
							onInput={(e) => setStartPoint(e.currentTarget.value)}
							class="w-full px-4 py-3 bg-muted border border-border rounded-xl text-base"
							placeholder="main, commit hash, or tag"
						/>
					</div>
				</div>

				<div class="flex items-center gap-3 mt-6">
					<button
						type="button"
						onClick={props.onClose}
						class="flex-1 h-14 text-base rounded-xl border border-border active:bg-muted"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={!name().trim()}
						class="flex-1 h-14 text-base font-medium rounded-xl bg-foreground text-background active:opacity-80 disabled:opacity-50"
					>
						Create
					</button>
				</div>
			</form>
		</div>
	);
}

// Main Git Panel component
export function GitPanel(props: { onClose: () => void }) {
	const [tab, setTab] = createSignal<Tab>("log");
	const [commits, setCommits] = createSignal<GitCommit[]>([]);
	const [currentBranch, setCurrentBranch] = createSignal("");
	const [loading, setLoading] = createSignal(true);
	const [selectedCommit, setSelectedCommit] = createSignal<string | null>(null);
	const [showCreateBranch, setShowCreateBranch] = createSignal(false);
	const [actionLoading, setActionLoading] = createSignal(false);
	const [message, setMessage] = createSignal<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const loadCommits = async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/git/log?count=100");
			if (res.ok) {
				const data = await res.json();
				setCommits(data.commits);
				setCurrentBranch(data.currentBranch);
			}
		} catch (err) {
			console.error("Failed to load commits:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(loadCommits);

	const showMsg = (type: "success" | "error", text: string) => {
		setMessage({ type, text });
		setTimeout(() => setMessage(null), 3000);
	};

	// Git actions
	const handlePull = async () => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/pull", { method: "POST" });
			if (res.ok) {
				showMsg("success", "Pulled successfully");
				loadCommits();
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Pull failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handlePush = async () => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/push", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ setUpstream: true }),
			});
			if (res.ok) {
				showMsg("success", "Pushed successfully");
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Push failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleFetch = async () => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/fetch", { method: "POST" });
			if (res.ok) {
				showMsg("success", "Fetched successfully");
				loadCommits();
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Fetch failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleCommitAction = async (action: string, hash: string) => {
		setActionLoading(true);
		try {
			let endpoint = "";
			let body: Record<string, unknown> = { hash };

			switch (action) {
				case "cherry-pick":
					endpoint = "/api/git/cherry-pick";
					break;
				case "revert":
					endpoint = "/api/git/revert";
					break;
				case "reset-soft":
					endpoint = "/api/git/reset";
					body = { hash, mode: "soft" };
					break;
				case "reset-hard":
					endpoint = "/api/git/reset";
					body = { hash, mode: "hard" };
					break;
				default:
					return;
			}

			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (res.ok) {
				showMsg("success", `${action} completed`);
				loadCommits();
				setSelectedCommit(null);
			} else {
				const data = await res.json();
				showMsg("error", data.error || `${action} failed`);
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleSwitchBranch = async (branch: string) => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/checkout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ branch }),
			});
			if (res.ok) {
				showMsg("success", `Switched to ${branch}`);
				loadCommits();
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Checkout failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleMergeBranch = async (branch: string) => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/merge", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ branch }),
			});
			if (res.ok) {
				showMsg("success", `Merged ${branch}`);
				loadCommits();
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Merge failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleDeleteBranch = async (branch: string) => {
		if (!confirm(`Delete branch "${branch}"?`)) return;

		setActionLoading(true);
		try {
			const res = await fetch(
				`/api/git/branches/${encodeURIComponent(branch)}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				showMsg("success", `Deleted ${branch}`);
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Delete failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleCreateBranch = async (name: string, startPoint?: string) => {
		setActionLoading(true);
		try {
			const res = await fetch("/api/git/branches", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name, startPoint }),
			});
			if (res.ok) {
				showMsg("success", `Created ${name}`);
				setShowCreateBranch(false);
				loadCommits();
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Create failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleStashSave = async () => {
		const msg = prompt("Stash message (optional):");
		if (msg === null) return;

		setActionLoading(true);
		try {
			const res = await fetch("/api/git/stashes", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: msg || undefined }),
			});
			if (res.ok) {
				showMsg("success", "Changes stashed");
			} else {
				const data = await res.json();
				showMsg("error", data.error || "Stash failed");
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	const handleStashAction = async (
		action: "pop" | "apply" | "drop",
		index: number,
	) => {
		setActionLoading(true);
		try {
			const res = await fetch(`/api/git/stashes/${index}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});
			if (res.ok) {
				showMsg("success", `Stash ${action} completed`);
			} else {
				const data = await res.json();
				showMsg("error", data.error || `Stash ${action} failed`);
			}
		} catch (err) {
			showMsg("error", String(err));
		} finally {
			setActionLoading(false);
		}
	};

	return (
		<div class="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header - compact but touchable */}
			<div class="flex items-center gap-3 px-4 py-3 border-b border-border">
				<button
					type="button"
					onClick={props.onClose}
					class="w-10 h-10 rounded-xl flex items-center justify-center active:bg-muted"
				>
					<svg
						class="w-6 h-6"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M6 18L18 6M6 6l12 12"
						/>
					</svg>
				</button>
				<div class="flex-1">
					<div class="font-medium">Git</div>
					<div class="text-sm text-muted-foreground font-mono">
						{currentBranch()}
					</div>
				</div>
			</div>

			{/* Message toast */}
			<Show when={message()}>
				<div
					class="mx-4 mt-2 px-4 py-3 rounded-xl text-base"
					classList={{
						"bg-green-500/20 text-green-400": message()?.type === "success",
						"bg-red-500/20 text-red-400": message()?.type === "error",
					}}
				>
					{message()?.text}
				</div>
			</Show>

			{/* Content area */}
			<div class="flex-1 overflow-hidden">
				{/* Commit detail view */}
				<Show when={selectedCommit()}>
					<CommitDetail
						hash={selectedCommit()!}
						onClose={() => setSelectedCommit(null)}
						onAction={handleCommitAction}
					/>
				</Show>

				{/* Log tab */}
				<Show when={!selectedCommit() && tab() === "log"}>
					<Show when={loading()}>
						<div class="flex items-center justify-center h-32">
							<span class="text-muted-foreground">Loading...</span>
						</div>
					</Show>

					<Show when={!loading()}>
						<div class="h-full overflow-y-auto pb-40">
							<For each={commits()}>
								{(commit) => (
									<CommitRow
										commit={commit}
										isSelected={selectedCommit() === commit.hash}
										onClick={() => setSelectedCommit(commit.hash)}
									/>
								)}
							</For>
						</div>
					</Show>
				</Show>

				{/* Branches tab */}
				<Show when={!selectedCommit() && tab() === "branches"}>
					<BranchList
						onSwitch={handleSwitchBranch}
						onMerge={handleMergeBranch}
						onDelete={handleDeleteBranch}
						onCreate={() => setShowCreateBranch(true)}
					/>
				</Show>

				{/* Stashes tab */}
				<Show when={!selectedCommit() && tab() === "stashes"}>
					<StashList
						onPop={(i) => handleStashAction("pop", i)}
						onApply={(i) => handleStashAction("apply", i)}
						onDrop={(i) => handleStashAction("drop", i)}
						onSave={handleStashSave}
					/>
				</Show>
			</div>

			{/* Fixed bottom navigation - large touch targets */}
			<Show when={!selectedCommit()}>
				<div class="fixed bottom-0 left-0 right-0 bg-background border-t border-border safe-area-inset-bottom">
					{/* Action buttons */}
					<div class="flex items-center gap-2 px-4 py-3 border-b border-border">
						<button
							type="button"
							onClick={handleFetch}
							disabled={actionLoading()}
							class="flex-1 h-11 text-sm font-medium rounded-xl bg-muted active:bg-muted/70 disabled:opacity-50"
						>
							Fetch
						</button>
						<button
							type="button"
							onClick={handlePull}
							disabled={actionLoading()}
							class="flex-1 h-11 text-sm font-medium rounded-xl bg-muted active:bg-muted/70 disabled:opacity-50"
						>
							Pull
						</button>
						<button
							type="button"
							onClick={handlePush}
							disabled={actionLoading()}
							class="flex-1 h-11 text-sm font-medium rounded-xl bg-foreground text-background active:opacity-80 disabled:opacity-50"
						>
							Push
						</button>
					</div>

					{/* Tab bar */}
					<div class="flex pb-2">
						<button
							type="button"
							onClick={() => setTab("log")}
							class="flex-1 flex flex-col items-center gap-1 py-3 active:bg-muted/50"
							classList={{
								"text-foreground": tab() === "log",
								"text-muted-foreground": tab() !== "log",
							}}
						>
							<svg
								class="w-6 h-6"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
								/>
							</svg>
							<span class="text-xs font-medium">History</span>
						</button>
						<button
							type="button"
							onClick={() => setTab("branches")}
							class="flex-1 flex flex-col items-center gap-1 py-3 active:bg-muted/50"
							classList={{
								"text-foreground": tab() === "branches",
								"text-muted-foreground": tab() !== "branches",
							}}
						>
							<svg
								class="w-6 h-6"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M13 10V3L4 14h7v7l9-11h-7z"
								/>
							</svg>
							<span class="text-xs font-medium">Branches</span>
						</button>
						<button
							type="button"
							onClick={() => setTab("stashes")}
							class="flex-1 flex flex-col items-center gap-1 py-3 active:bg-muted/50"
							classList={{
								"text-foreground": tab() === "stashes",
								"text-muted-foreground": tab() !== "stashes",
							}}
						>
							<svg
								class="w-6 h-6"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
								/>
							</svg>
							<span class="text-xs font-medium">Stashes</span>
						</button>
					</div>
				</div>
			</Show>

			{/* Create branch dialog */}
			<Show when={showCreateBranch()}>
				<CreateBranchDialog
					onClose={() => setShowCreateBranch(false)}
					onCreate={handleCreateBranch}
				/>
			</Show>
		</div>
	);
}
