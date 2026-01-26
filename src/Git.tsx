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
	createHighlighter,
	type BundledLanguage,
	type Highlighter,
} from "shiki";

const API_URL = "";

// Pre-initialize highlighter with common languages
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;

function getHighlighter(): Highlighter | null {
	if (highlighterInstance) return highlighterInstance;

	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ["vitesse-black"],
			langs: [
				"typescript",
				"tsx",
				"javascript",
				"jsx",
				"python",
				"go",
				"rust",
				"json",
				"yaml",
				"html",
				"css",
				"bash",
				"markdown",
				"sql",
			],
		}).then((h) => {
			highlighterInstance = h;
			return h;
		});
	}

	return null;
}

// Start loading immediately
getHighlighter();

// Git diff types
export type GitStatus = {
	hasChanges: boolean;
	insertions: number;
	deletions: number;
	filesChanged: number;
};

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

// Map file extensions to Shiki language identifiers
function getLanguageFromPath(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() || "";
	const extMap: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
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
		toml: "toml",
		xml: "xml",
		html: "html",
		css: "css",
		scss: "scss",
		less: "less",
		md: "markdown",
		sql: "sql",
		graphql: "graphql",
		dockerfile: "dockerfile",
		makefile: "makefile",
	};
	return extMap[ext] || "text";
}

// Cache for highlighted hunks
const hunkHighlightCache = new Map<
	string,
	Array<Array<{ content: string; color?: string }>>
>();

// Highlight a hunk synchronously if highlighter is ready
function highlightHunkSync(
	lines: DiffLine[],
	lang: string
): Array<Array<{ content: string; color?: string }>> | null {
	const code = lines.map((l) => l.content).join("\n");
	const cacheKey = `${lang}:${code}`;

	if (hunkHighlightCache.has(cacheKey)) {
		return hunkHighlightCache.get(cacheKey)!;
	}

	const highlighter = getHighlighter();
	if (!highlighter) return null;

	const loadedLangs = highlighter.getLoadedLanguages();
	const validLang = (
		loadedLangs.includes(lang) ? lang : "text"
	) as BundledLanguage;

	try {
		const { tokens } = highlighter.codeToTokens(code, {
			lang: validLang,
			theme: "vitesse-black",
		});

		const result = tokens.map((lineTokens) =>
			lineTokens.map((token) => ({
				content: token.content,
				color: token.color,
			}))
		);

		hunkHighlightCache.set(cacheKey, result);
		return result;
	} catch {
		return lines.map((l) => [{ content: l.content || " " }]);
	}
}

function DiffHunkView(props: { hunk: DiffHunk; lang: string }) {
	// Try to highlight synchronously - will return null if highlighter not ready
	const highlightedLines = createMemo(() =>
		highlightHunkSync(props.hunk.lines, props.lang)
	);

	return (
		<div>
			<div class="px-4 py-1 bg-blue-500/10 text-blue-400 font-mono text-xs">
				{props.hunk.header}
			</div>
			<div class="font-mono text-sm">
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
							<pre class="px-2 whitespace-pre">
								<Show
									when={highlightedLines()?.[index()]}
									fallback={line.content || " "}
								>
									<For each={highlightedLines()![index()]}>
										{(token) => (
											<span style={{ color: token.color }}>
												{token.content}
											</span>
										)}
									</For>
								</Show>
							</pre>
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
}) {
	return (
		<Show when={props.gitStatus}>
			<button
				type="button"
				onClick={props.onClick}
				disabled={!props.gitStatus?.hasChanges}
				class={`w-14 h-14 rounded-full flex flex-col items-center justify-center bg-background border border-border transition-colors shadow-lg ${
					props.gitStatus?.hasChanges
						? "hover:bg-muted"
						: "opacity-50 cursor-default"
				}`}
				title={props.gitStatus?.hasChanges ? "View git changes" : "No changes"}
			>
				<span class="text-xs font-mono leading-none">
					<span class={props.gitStatus?.hasChanges ? "text-green-500" : "text-muted-foreground"}>
						+{props.gitStatus!.insertions}
					</span>
				</span>
				<span class="text-xs font-mono leading-none mt-0.5">
					<span class={props.gitStatus?.hasChanges ? "text-red-500" : "text-muted-foreground"}>
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
