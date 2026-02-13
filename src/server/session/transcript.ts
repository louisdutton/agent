import type { Message, Tool } from "./session.ts";

type Transcript = {
	messages: Message[];
	isCompacted: boolean;
};

// Parse transcript content into messages
export function parseTranscript(content: string): Transcript {
	const lines = content.trim().split("\n").filter(Boolean);
	const messages: Message[] = [];
	const toolResults = new Map<string, boolean>();
	let isCompacted = false;
	let compactBoundaryIndex = -1;

	// Store tool result ima es: tool_use_id -> base64 data URLs
	const toolResultImages = new Map<string, string[]>();

	// First pass: find compact boundary and collect all tool results
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		try {
			const entry = JSON.parse(line);
			// Check for compact boundary marker
			if (entry.type === "system" && entry.subtype === "compact_boundary") {
				isCompacted = true;
				compactBoundaryIndex = i;
			}
			if (entry.type === "user" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (Array.isArray(entryContent)) {
					for (const block of entryContent) {
						if (block.type === "tool_result" && block.tool_use_id) {
							toolResults.set(block.tool_use_id, !!block.is_error);
							// Extract images from tool result content
							if (Array.isArray(block.content)) {
								const images: string[] = [];
								for (const resultBlock of block.content) {
									if (
										resultBlock.type === "image" &&
										resultBlock.source?.type === "base64" &&
										resultBlock.source?.media_type &&
										resultBlock.source?.data
									) {
										images.push(
											`data:${resultBlock.source.media_type};base64,${resultBlock.source.data}`,
										);
									}
								}
								if (images.length > 0) {
									toolResultImages.set(block.tool_use_id, images);
								}
							}
						}
					}
				}
			}
		} catch {
			// Skip invalid JSON
		}
	}

	// If compacted, only process lines after the compact boundary
	// Skip the boundary itself and the summary message that follows
	const startIndex = isCompacted ? compactBoundaryIndex + 2 : 0;

	// Second pass: build messages (starting after compact boundary if present)
	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i];
		try {
			const entry = JSON.parse(line);
			if (entry.type === "user" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (typeof entryContent === "string") {
					if (!entry.isMeta && !entryContent.startsWith("<")) {
						messages.push({
							type: "user",
							id: entry.uuid,
							content: entryContent,
						});
					}
				} else if (Array.isArray(entryContent)) {
					const textBlocks = entryContent.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "user", id: entry.uuid, content: text });
					}
				}
			} else if (entry.type === "assistant" && entry.message?.content) {
				const entryContent = entry.message.content;
				if (!Array.isArray(entryContent)) continue;

				const textBlocks = entryContent.filter(
					(b: { type: string }) => b.type === "text",
				);
				const text = textBlocks.map((b: { text: string }) => b.text).join("");
				if (text) {
					messages.push({ type: "assistant", id: entry.uuid, content: text });
				}

				const toolUses = entryContent.filter(
					(b: { type: string }) => b.type === "tool_use",
				);
				if (toolUses.length > 0) {
					const tools: Tool[] = toolUses.map(
						(t: {
							id: string;
							name: string;
							input: Record<string, unknown>;
						}) => ({
							toolUseId: t.id,
							name: t.name,
							input: t.input || {},
							status: toolResults.has(t.id)
								? toolResults.get(t.id)
									? "error"
									: "complete"
								: "complete",
							resultImages: toolResultImages.get(t.id),
						}),
					);
					messages.push({
						type: "tools",
						id: `tools-${entry.uuid}`,
						tools,
					});
				}
			}
		} catch {
			// Skip invalid JSON lines
		}
	}

	// Merge consecutive tool groups
	const mergedMessages: Message[] = [];
	for (const msg of messages) {
		const last = mergedMessages[mergedMessages.length - 1];
		if (msg.type === "tools" && last && last.type === "tools") {
			mergedMessages[mergedMessages.length - 1] = {
				...last,
				tools: [...last.tools, ...msg.tools],
			};
		} else {
			mergedMessages.push(msg);
		}
	}

	return { messages: mergedMessages, isCompacted };
}
