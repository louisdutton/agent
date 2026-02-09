export type ToolStatus = "running" | "complete" | "error";

export type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: ToolStatus;
	resultImages?: string[]; // Base64 data URLs from tool results (e.g., Playwright screenshots)
};

export type EventItem =
	| { type: "user"; id: string; content: string; images?: string[] }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] }
	| { type: "error"; id: string; message: string };
