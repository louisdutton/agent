import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import {
	computeDiff,
	type DiffFile,
	type DiffHunk,
	type DiffLine,
	type DiffLineType,
} from "./diff";
import { createLongPress } from "./gestures";
import hljs from "./hljs";

const API_URL = "";

// Git diff types
export type GitStatus = {
	hasChanges: boolean;
	insertions: number;
	deletions: number;
	filesChanged: number;
};

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
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		h: "c",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		json: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "ini",
		xml: "xml",
		html: "xml",
		css: "css",
		scss: "scss",
		less: "less",
		md: "markdown",
		sql: "sql",
		graphql: "graphql",
		dockerfile: "dockerfile",
		makefile: "makefile",
	};
	return extMap[ext] || "";
}

// Highlight code synchronously with highlight.js
function highlightCodeSync(code: string, lang: string): string[] {
	try {
		const lines = code.split("\n");
		return lines.map((line) => {
			if (!line.trim()) return line || " ";
			let result: hljs.HighlightResult;
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

// Highlight a hunk synchronously
function highlightHunkSync(lines: DiffLine[], lang: string): string[] {
	const code = lines.map((l) => l.content).join("\n");
	return highlightCodeSync(code, lang);
}

function DiffHunkView(props: { hunk: DiffHunk; lang: string }) {
	const highlightedLines = createMemo(() =>
		highlightHunkSync(props.hunk.lines, props.lang),
	);

	return (
		<div>
			<div class="px-4 py-1 bg-blue-500/10 text-blue-400 font-mono text-xs">
				{props.hunk.header}
			</div>
			<div class="font-mono text-xs">
				<For each={props.hunk.lines}>
					{(line, index) => (
						<div
							class={`flex ${
								line.type === "addition"
									? "bg-green-500/15"
									: line.type === "deletion"
										? "bg-red-500/15"
										: ""
							}`}
						>
							<span class="w-12 shrink-0 text-right px-2 text-muted-foreground/50 select-none border-r border-border">
								{line.oldLineNum ?? ""}
							</span>
							<span class="w-12 shrink-0 text-right px-2 text-muted-foreground/50 select-none border-r border-border">
								{line.newLineNum ?? ""}
							</span>
							<span
								class={`w-6 shrink-0 text-center select-none ${
									line.type === "addition"
										? "text-green-500"
										: line.type === "deletion"
											? "text-red-500"
											: "text-muted-foreground"
								}`}
							>
								{line.type === "addition"
									? "+"
									: line.type === "deletion"
										? "-"
										: " "}
							</span>
							<pre
								class="px-2 whitespace-pre hljs"
								innerHTML={highlightedLines()?.[index()] || line.content || " "}
							/>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}

function DiffFileView(props: { file: DiffFile }) {
	const [expanded, setExpanded] = createSignal(true);

	const lang = createMemo(() => getLanguageFromPath(props.file.path));

	const statusColors: Record<string, string> = {
		modified: "text-yellow-500",
		added: "text-green-500",
		deleted: "text-red-500",
		renamed: "text-blue-500",
	};

	const statusIcons: Record<string, string> = {
		modified: "M",
		added: "A",
		deleted: "D",
		renamed: "R",
	};

	return (
		<div class="border border-border rounded-lg overflow-hidden">
			<button
				type="button"
				onClick={() => setExpanded(!expanded())}
				class="w-full flex items-center gap-3 px-4 py-3 bg-muted hover:bg-muted/80 transition-colors"
			>
				<span
					class={`font-mono text-sm font-medium ${statusColors[props.file.status]}`}
				>
					{statusIcons[props.file.status]}
				</span>
				<span class="font-mono text-sm flex-1 text-left truncate">
					{props.file.path}
				</span>
				<svg
					class={`w-4 h-4 transition-transform ${expanded() ? "rotate-180" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>

			<Show when={expanded()}>
				<div class="overflow-x-auto">
					<div class="min-w-max">
						<For each={props.file.hunks}>
							{(hunk) => <DiffHunkView hunk={hunk} lang={lang()} />}
						</For>
					</div>
				</div>
			</Show>
		</div>
	);
}

export function useGitStatus() {
	const [gitStatus, setGitStatus] = createSignal<GitStatus | null>(null);

	onMount(() => {
		const fetchGitStatus = async () => {
			try {
				const res = await fetch(`${API_URL}/api/git/status`);
				if (res.ok) {
					const data = await res.json();
					setGitStatus(data);
				} else {
					setGitStatus({
						hasChanges: false,
						insertions: 0,
						deletions: 0,
						filesChanged: 0,
					});
				}
			} catch (err) {
				console.error("Git status error:", err);
				setGitStatus({
					hasChanges: false,
					insertions: 0,
					deletions: 0,
					filesChanged: 0,
				});
			}
		};

		fetchGitStatus();
		const interval = setInterval(fetchGitStatus, 5000);
		onCleanup(() => clearInterval(interval));
	});

	return gitStatus;
}

export function GitStatusIndicator(props: {
	gitStatus: GitStatus | null;
	onClick: () => void;
	onLongPress?: () => void;
}) {
	const { handlers, isPressing } = createLongPress({
		onPress: () => {
			if (props.gitStatus?.hasChanges) {
				props.onClick();
			}
		},
		onLongPress: () => {
			props.onLongPress?.();
		},
	});

	return (
		<Show when={props.gitStatus}>
			<button
				type="button"
				onMouseDown={handlers.onMouseDown}
				onMouseUp={handlers.onMouseUp}
				onMouseLeave={handlers.onMouseLeave}
				onTouchStart={handlers.onTouchStart}
				onTouchEnd={handlers.onTouchEnd}
				onTouchCancel={handlers.onTouchCancel}
				class="w-20 h-20 rounded-full flex flex-col items-center justify-center bg-background border border-white/30 shadow-lg select-none hover:bg-muted"
				classList={{
					"scale-110 bg-white/20 transition-transform duration-500":
						isPressing(),
					"transition-all duration-150": !isPressing(),
				}}
				title="Tap: git changes, Hold: browse files"
			>
				<span class="text-sm font-mono leading-none">
					<span
						class={
							props.gitStatus?.hasChanges
								? "text-green-500"
								: "text-muted-foreground"
						}
					>
						+{props.gitStatus!.insertions}
					</span>
				</span>
				<span class="text-sm font-mono leading-none mt-0.5">
					<span
						class={
							props.gitStatus?.hasChanges
								? "text-red-500"
								: "text-muted-foreground"
						}
					>
						-{props.gitStatus!.deletions}
					</span>
				</span>
			</button>
		</Show>
	);
}

export function GitDiffModal(props: {
	show: boolean;
	onClose: () => void;
	onCommit: () => void;
}) {
	const [diffData, setDiffData] = createSignal<DiffFile[] | null>(null);
	const [diffLoading, setDiffLoading] = createSignal(false);

	createEffect(() => {
		if (props.show) {
			setDiffLoading(true);
			fetch(`${API_URL}/api/git/diff`)
				.then((res) => (res.ok ? res.json() : null))
				.then((data) => {
					if (data) setDiffData(data.files);
				})
				.catch((err) => console.error("Git diff error:", err))
				.finally(() => setDiffLoading(false));
		}
	});

	return (
		<Show when={props.show}>
			<div
				class="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
				onClick={(e) => {
					if (e.target === e.currentTarget) props.onClose();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") props.onClose();
				}}
			>
				<div class="h-full flex flex-col">
					{/* Content */}
					<div class="flex-1 overflow-y-auto p-4">
						<Show when={diffLoading()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-muted-foreground">Loading diff...</span>
							</div>
						</Show>

						<Show when={!diffLoading() && diffData()}>
							<div class="space-y-6 max-w-4xl mx-auto">
								<For each={diffData()}>
									{(file) => <DiffFileView file={file} />}
								</For>
							</div>
						</Show>

						<Show when={!diffLoading() && diffData()?.length === 0}>
							<div class="text-center text-muted-foreground py-8">
								No changes detected
							</div>
						</Show>
					</div>

					{/* Bottom bar - secondary on left, primary on right */}
					<div class="flex items-center justify-between px-4 pb-6 pt-2">
						<button
							type="button"
							onClick={props.onClose}
							class="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
						>
							Close
						</button>
						<button
							type="button"
							onClick={props.onCommit}
							class="btn px-4 py-2 text-sm"
						>
							Commit
						</button>
					</div>
				</div>
			</div>
		</Show>
	);
}

export function FileViewerModal(props: {
	show: boolean;
	filePath: string;
	onClose: () => void;
}) {
	const [content, setContent] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const lang = createMemo(() => getLanguageFromPath(props.filePath));
	const fileName = createMemo(
		() => props.filePath.split("/").pop() || props.filePath,
	);

	const highlightedLines = createMemo(() => {
		const code = content();
		if (!code) return null;
		return highlightCodeSync(code, lang());
	});

	createEffect(() => {
		if (props.show && props.filePath) {
			setLoading(true);
			setError(null);
			setContent(null);
			fetch(`${API_URL}/api/file/${encodeURIComponent(props.filePath)}`)
				.then((res) => {
					if (!res.ok) {
						throw new Error(
							res.status === 404 ? "File not found" : "Failed to load file",
						);
					}
					return res.json();
				})
				.then((data) => {
					setContent(data.content);
				})
				.catch((err) => {
					console.error("File load error:", err);
					setError(err.message || "Failed to load file");
				})
				.finally(() => setLoading(false));
		}
	});

	const lines = createMemo(() => content()?.split("\n") || []);

	return (
		<Show when={props.show}>
			<div
				class="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
				onClick={(e) => {
					if (e.target === e.currentTarget) props.onClose();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") props.onClose();
				}}
			>
				<div class="h-full flex flex-col">
					{/* Header */}
					<div class="flex items-center gap-3 px-4 py-3 border-b border-border">
						<span class="font-mono text-sm text-foreground truncate flex-1">
							{props.filePath}
						</span>
						<span class="text-xs text-muted-foreground shrink-0">
							{lines().length} lines
						</span>
					</div>

					{/* Content */}
					<div class="flex-1 overflow-y-auto">
						<Show when={loading()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-muted-foreground">Loading...</span>
							</div>
						</Show>

						<Show when={error()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-red-500">{error()}</span>
							</div>
						</Show>

						<Show when={!loading() && !error() && content() !== null}>
							<div class="overflow-x-auto">
								<div class="min-w-max font-mono text-xs">
									<For each={lines()}>
										{(line, index) => (
											<div class="flex hover:bg-muted/30">
												<span class="shrink-0 text-right pl-2 pr-2 py-0 text-muted-foreground/50 select-none border-r border-border tabular-nums">
													{index() + 1}
												</span>
												<pre
													class="px-4 whitespace-pre py-0 hljs"
													innerHTML={
														highlightedLines()?.[index()] || line || " "
													}
												/>
											</div>
										)}
									</For>
								</div>
							</div>
						</Show>
					</div>

					{/* Bottom bar */}
					<div class="flex items-center justify-between px-4 pb-6 pt-2">
						<button
							type="button"
							onClick={props.onClose}
							class="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
						>
							Close
						</button>
						<span class="text-xs text-muted-foreground">{fileName()}</span>
					</div>
				</div>
			</div>
		</Show>
	);
}

type FileEntry = {
	name: string;
	path: string;
	isDirectory: boolean;
};

// Inline diff view for Edit/Write tool calls
export function InlineDiffView(props: {
	filePath: string;
	oldContent?: string;
	newContent: string;
	isNewFile?: boolean;
}) {
	const lang = createMemo(() => getLanguageFromPath(props.filePath));

	// Generate diff lines from old/new content
	const diffLines = createMemo(() => {
		if (props.isNewFile || !props.oldContent) {
			// New file - all lines are additions
			const newLines = props.newContent.split("\n");
			return newLines.map((line, i) => ({
				type: "addition" as DiffLineType,
				content: line,
				newLineNum: i + 1,
			}));
		}

		// Compute actual diff between old and new content
		const oldLines = props.oldContent.split("\n");
		const newLines = props.newContent.split("\n");
		return computeDiff(oldLines, newLines);
	});

	// Highlight all lines together
	const highlightedLines = createMemo(() => {
		const code = diffLines()
			.map((l) => l.content)
			.join("\n");
		return highlightCodeSync(code, lang());
	});

	return (
		<div class="border border-border rounded-lg overflow-hidden mt-2 overflow-x-auto max-h-64 overflow-y-auto">
			<div class="min-w-max font-mono text-xs">
				<For each={diffLines()}>
					{(line, index) => (
						<div
							class={`flex ${
								line.type === "addition"
									? "bg-green-500/15"
									: line.type === "deletion"
										? "bg-red-500/15"
										: ""
							}`}
						>
							<span
								class={`w-5 shrink-0 text-center select-none ${
									line.type === "addition"
										? "text-green-500"
										: line.type === "deletion"
											? "text-red-500"
											: "text-muted-foreground"
								}`}
							>
								{line.type === "addition"
									? "+"
									: line.type === "deletion"
										? "-"
										: " "}
							</span>
							<pre
								class="px-2 whitespace-pre hljs"
								innerHTML={highlightedLines()?.[index()] || line.content || " "}
							/>
						</div>
					)}
				</For>
			</div>
		</div>
	);
}

export function FileBrowserModal(props: {
	show: boolean;
	onClose: () => void;
	onSelectFile: (path: string) => void;
}) {
	const [currentPath, setCurrentPath] = createSignal("");
	const [files, setFiles] = createSignal<FileEntry[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(null);

	const loadDirectory = async (path: string) => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(
				`${API_URL}/api/files?path=${encodeURIComponent(path)}`,
			);
			if (!res.ok) {
				throw new Error("Failed to load directory");
			}
			const data = await res.json();
			setFiles(data.files);
			setCurrentPath(data.path);
		} catch (err) {
			console.error("Directory load error:", err);
			setError(String(err));
		} finally {
			setLoading(false);
		}
	};

	createEffect(() => {
		if (props.show) {
			loadDirectory("");
		}
	});

	const handleClick = (file: FileEntry) => {
		if (file.isDirectory) {
			loadDirectory(file.path);
		} else {
			props.onSelectFile(file.path);
		}
	};

	const goUp = () => {
		const parts = currentPath().split("/");
		parts.pop();
		loadDirectory(parts.join("/"));
	};

	return (
		<Show when={props.show}>
			<div
				class="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
				onClick={(e) => {
					if (e.target === e.currentTarget) props.onClose();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") props.onClose();
				}}
			>
				<div class="h-full flex flex-col">
					{/* Header */}
					<div class="flex items-center gap-3 px-4 py-3 border-b border-border">
						<button
							type="button"
							onClick={goUp}
							disabled={!currentPath()}
							class="p-1 hover:bg-muted rounded transition-colors disabled:opacity-30"
							title="Go up"
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
									d="M15 19l-7-7 7-7"
								/>
							</svg>
						</button>
						<span class="font-mono text-sm text-foreground truncate flex-1">
							{currentPath() || "/"}
						</span>
					</div>

					{/* Content */}
					<div class="flex-1 overflow-y-auto p-2">
						<Show when={loading()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-muted-foreground">Loading...</span>
							</div>
						</Show>

						<Show when={error()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-red-500">{error()}</span>
							</div>
						</Show>

						<Show when={!loading() && !error()}>
							<div class="space-y-0.5">
								<For each={files()}>
									{(file) => (
										<button
											type="button"
											onClick={() => handleClick(file)}
											class="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted rounded-lg transition-colors text-left"
										>
											<svg
												class="w-5 h-5 shrink-0 text-muted-foreground"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												{file.isDirectory ? (
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
													/>
												) : (
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
													/>
												)}
											</svg>
											<span class="font-mono text-xs truncate">
												{file.name}
											</span>
										</button>
									)}
								</For>
							</div>
						</Show>
					</div>

					{/* Bottom bar */}
					<div class="flex items-center px-4 pb-6 pt-2">
						<button
							type="button"
							onClick={props.onClose}
							class="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
						>
							Close
						</button>
					</div>
				</div>
			</div>
		</Show>
	);
}
