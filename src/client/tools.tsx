import { createSignal, For, Show } from "solid-js";
import { InlineDiffView } from "./git";
import type { Tool } from "./types";

export function getToolSummary(
	name: string,
	input: Record<string, unknown>,
): string {
	switch (name) {
		case "Read":
			return String(input.file_path || "")
				.split("/")
				.slice(-2)
				.join("/");
		case "Edit":
		case "Write":
			return String(input.file_path || "")
				.split("/")
				.slice(-2)
				.join("/");
		case "Bash": {
			const cmd = String(input.command || "");
			return cmd.length > 50 ? `${cmd.slice(0, 50)}...` : cmd;
		}
		case "Glob":
			return String(input.pattern || "");
		case "Grep":
			return `${input.pattern || ""} ${input.path ? `in ${String(input.path).split("/").pop()}` : ""}`;
		case "Task":
			return String(input.description || input.prompt || "").slice(0, 40);
		case "WebFetch":
			return String(input.url || "")
				.replace(/^https?:\/\//, "")
				.slice(0, 40);
		case "WebSearch":
			return String(input.query || "");
		default:
			if (input.file_path)
				return String(input.file_path).split("/").pop() || "";
			if (input.path) return String(input.path).split("/").pop() || "";
			if (input.command) return String(input.command).slice(0, 30);
			if (input.query) return String(input.query).slice(0, 30);
			return "";
	}
}

function ToolItem(props: {
	tool: Tool;
	onOpenFile?: (path: string) => void;
}) {
	// Check if tool has a file path that can be opened
	const getFilePath = (tool: Tool): string | null => {
		if (["Read", "Edit", "Write"].includes(tool.name) && tool.input.file_path) {
			return String(tool.input.file_path);
		}
		return null;
	};

	// Check if tool has diff content to show
	const getToolDiff = (
		tool: Tool,
	): {
		filePath: string;
		oldContent?: string;
		newContent: string;
		isNewFile: boolean;
	} | null => {
		if (tool.name === "Edit" && tool.input.file_path && tool.input.new_string) {
			return {
				filePath: String(tool.input.file_path),
				oldContent: tool.input.old_string
					? String(tool.input.old_string)
					: undefined,
				newContent: String(tool.input.new_string),
				isNewFile: false,
			};
		}
		if (tool.name === "Write" && tool.input.file_path && tool.input.content) {
			return {
				filePath: String(tool.input.file_path),
				newContent: String(tool.input.content),
				isNewFile: true,
			};
		}
		return null;
	};

	const filePath = getFilePath(props.tool);
	const diffData = getToolDiff(props.tool);

	return (
		<div>
			<div class="flex items-start gap-2">
				<span
					class={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
						props.tool.status === "running"
							? "bg-yellow-500"
							: props.tool.status === "error"
								? "bg-red-500"
								: "bg-green-500"
					}`}
				/>
				<div class="min-w-0 flex-1">
					<span class="font-mono text-muted-foreground">
						{props.tool.name}
					</span>
					{filePath && props.onOpenFile ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								props.onOpenFile?.(filePath);
							}}
							class="text-muted-foreground opacity-60 ml-2 break-all hover:text-foreground hover:opacity-100 transition-colors text-left"
						>
							{getToolSummary(props.tool.name, props.tool.input)}
						</button>
					) : (
						<span class="text-muted-foreground opacity-60 ml-2 break-all">
							{getToolSummary(props.tool.name, props.tool.input)}
						</span>
					)}
				</div>
			</div>
			{/* Inline diff for Edit/Write tools */}
			<Show when={diffData}>
				{(data) => (
					<InlineDiffView
						filePath={data().filePath}
						oldContent={data().oldContent}
						newContent={data().newContent}
						isNewFile={data().isNewFile}
					/>
				)}
			</Show>
			{/* Images from tool results (e.g., Playwright screenshots) */}
			<Show when={props.tool.resultImages?.length}>
				<div class="mt-2 flex flex-wrap gap-2">
					<For each={props.tool.resultImages}>
						{(img) => (
							<img
								src={img}
								alt="Tool result"
								class="max-w-full rounded-lg border border-border"
							/>
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}

export function ToolGroup(props: {
	tools: Tool[];
	defaultExpanded?: boolean;
	onOpenFile?: (path: string) => void;
}) {
	const [expanded, setExpanded] = createSignal(props.defaultExpanded || false);
	
	// Single tool - show in bubble but not expandable
	if (props.tools.length <= 1) {
		return (
			<div class="text-sm">
				<div class="p-3 rounded-xl border border-border bg-muted/40 shadow-sm">
					<For each={props.tools}>
						{(tool) => (
							<ToolItem tool={tool} onOpenFile={props.onOpenFile} />
						)}
					</For>
				</div>
			</div>
		);
	}

	// Multiple tools - show collapsible interface
	const lastTool = () => props.tools[props.tools.length - 1];
	const remainingCount = () => props.tools.length - 1;
	
	return (
		<div class="text-sm">
			<Show 
				when={expanded()}
				fallback={
					<button
						type="button"
						onClick={() => setExpanded(true)}
						class="w-full p-3 rounded-xl border border-border bg-muted/40 hover:bg-muted/60 transition-all duration-200 text-left shadow-sm hover:shadow-md"
					>
						<div class="flex items-start gap-2">
							<ToolItem tool={lastTool()} onOpenFile={props.onOpenFile} />
							<Show when={remainingCount() > 0}>
								<span class="text-xs text-muted-foreground/70 bg-muted/60 px-2 py-1 rounded-full flex-shrink-0 mt-0.5">
									+{remainingCount()}
								</span>
							</Show>
						</div>
					</button>
				}
			>
				<div class="p-3 rounded-xl border border-border bg-muted/40 space-y-3 shadow-sm">
					<div class="flex items-center justify-between pb-2 border-b border-border/70">
						<span class="text-xs font-medium text-muted-foreground/80">
							{props.tools.length} tool calls
						</span>
						<button
							type="button"
							onClick={() => setExpanded(false)}
							class="text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-1 rounded hover:bg-muted/60"
						>
							Collapse
						</button>
					</div>
					<For each={props.tools}>
						{(tool) => (
							<ToolItem tool={tool} onOpenFile={props.onOpenFile} />
						)}
					</For>
				</div>
			</Show>
		</div>
	);
}