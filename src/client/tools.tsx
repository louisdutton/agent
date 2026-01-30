import { For, Show } from "solid-js";
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

export function ToolGroup(props: {
	tools: Tool[];
	defaultExpanded?: boolean;
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

	return (
		<div class="text-sm space-y-2">
			<For each={props.tools}>
				{(tool) => {
					const filePath = getFilePath(tool);
					const diffData = getToolDiff(tool);
					return (
						<div>
							<div class="flex items-start gap-2">
								<span
									class={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${
										tool.status === "running"
											? "bg-yellow-500"
											: tool.status === "error"
												? "bg-red-500"
												: "bg-green-500"
									}`}
								/>
								<div class="min-w-0 flex-1">
									<span class="font-mono text-muted-foreground">
										{tool.name}
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
											{getToolSummary(tool.name, tool.input)}
										</button>
									) : (
										<span class="text-muted-foreground opacity-60 ml-2 break-all">
											{getToolSummary(tool.name, tool.input)}
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
						</div>
					);
				}}
			</For>
		</div>
	);
}
