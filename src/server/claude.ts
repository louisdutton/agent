import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	getCwd,
	setAbortController,
	setActiveSessionId,
} from "./session";

type ImageBlock = {
	type: "image";
	source: {
		type: "base64";
		media_type: string;
		data: string;
	};
};

type TextBlock = {
	type: "text";
	text: string;
};

type ContentBlock = TextBlock | ImageBlock;

// Build message content with images
function buildMessageContent(
	message: string,
	images?: string[],
): string | ContentBlock[] {
	if (!images?.length) {
		return message;
	}

	const content: ContentBlock[] = [];

	// Add images first
	for (const img of images) {
		// Parse data URL: data:image/png;base64,<data>
		const match = img.match(/^data:([^;]+);base64,(.+)$/);
		if (match) {
			content.push({
				type: "image",
				source: {
					type: "base64",
					media_type: match[1],
					data: match[2],
				},
			});
		}
	}

	// Add text message
	if (message) {
		content.push({ type: "text", text: message });
	}

	return content;
}

// Create an async generator that yields the user message with images
async function* createImagePrompt(
	message: string,
	images: string[],
	sessionId: string | null,
): AsyncGenerator<SDKUserMessage> {
	yield {
		type: "user",
		session_id: sessionId ?? "", // Empty string for new sessions, like SDK does internally
		message: {
			role: "user",
			content: buildMessageContent(message, images),
		},
		parent_tool_use_id: null,
	} as SDKUserMessage;
}

// Send a slash command to a session
async function sendSlashCommand(
	command: string,
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	const cwd = getCwd();

	console.debug(`Sending ${command} to session: ${sessionId}`);

	try {
		const options: Parameters<typeof query>[0]["options"] = {
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
			},
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			cwd,
			resume: sessionId,
			pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH,
		};

		for await (const event of query({
			prompt: command,
			options,
		})) {
			if (event.type === "result") {
				console.debug(`${command} complete`);
				return { success: true };
			}
		}

		return { success: true };
	} catch (err) {
		console.error(`${command} failed:`, err);
		return { success: false, error: String(err) };
	}
}

// Compact a session's context
export async function compactSession(
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	return sendSlashCommand("/compact", sessionId);
}

// Clear a session's context
export async function clearContext(
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	return sendSlashCommand("/clear", sessionId);
}


// Generator that yields session_id when available
export async function* sendMessage(
	message: string,
	sessionId: string | null,
	images?: string[],
): AsyncGenerator<string> {
	console.debug(
		`Sending: ${message.slice(0, 50)}...`,
		images?.length ? `(${images.length} images)` : "",
	);

	const cwd = getCwd();
	const abortController = new AbortController();
	setAbortController(abortController);

	// Track active session so UI can detect running state after refresh
	setActiveSessionId(sessionId);

	try {
		const options: Parameters<typeof query>[0]["options"] = {
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: "Your reponses must always be accurate and concise.",
			},
			// model: "claude-haiku-4-5",
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			includePartialMessages: true,
			abortController,
			cwd,
			pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH,
		};

		// Resume existing session if sessionId provided
		if (sessionId) {
			options.resume = sessionId;
		}
		// When sessionId is null, we start a fresh session by not setting resume

		const hasImages = images?.length;
		let actualSessionId = sessionId;

		// Use async generator for images, plain string for text-only
		const prompt = hasImages
			? createImagePrompt(message, images, sessionId)
			: message;

		for await (const event of query({
			prompt,
			options,
		})) {
			if (!actualSessionId && "session_id" in event && event.session_id) {
				actualSessionId = event.session_id;
				setActiveSessionId(actualSessionId);
			}
			yield JSON.stringify(event);
		}
	} finally {
		setAbortController(null);
		setActiveSessionId(null);
	}
}
