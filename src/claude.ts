import { query } from "@anthropic-ai/claude-agent-sdk";
import {
	getActiveSession,
	getActiveSessionCwd,
	getOrCreateSession,
	setAbortController,
	setActiveSession,
} from "./session";

// Compact the current session's context
export async function compactSession(): Promise<{
	success: boolean;
	error?: string;
}> {
	const sessionId = getActiveSession();
	const cwd = getActiveSessionCwd();

	if (!sessionId) {
		return { success: false, error: "No active session to compact" };
	}

	console.log(`Compacting session: ${sessionId}`);

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

		// Send /compact command to trigger session compaction
		for await (const event of query({
			prompt: "/compact",
			options,
		})) {
			// Wait for the result
			if (event.type === "result") {
				console.log("Compaction complete");
				return { success: true };
			}
		}

		return { success: true };
	} catch (err) {
		console.error("Compaction failed:", err);
		return { success: false, error: String(err) };
	}
}

export async function* sendMessage(message: string): AsyncGenerator<string> {
	console.log(`Sending: ${message.slice(0, 50)}...`);

	const sessionId = getActiveSession();
	const cwd = getActiveSessionCwd();

	const abortController = new AbortController();

	if (sessionId) {
		getOrCreateSession(sessionId, cwd);
		setAbortController(sessionId, abortController);
	}

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

		if (sessionId) {
			options.resume = sessionId;
		}
		// When sessionId is null, we start a fresh session by not setting resume or continue

		for await (const event of query({
			prompt: message,
			options,
		})) {
			// Capture session_id from result events to persist the session
			if (
				event.type === "result" &&
				"session_id" in event &&
				typeof event.session_id === "string"
			) {
				setActiveSession(event.session_id, cwd);
			}

			yield JSON.stringify(event);
		}
	} finally {
		if (sessionId) {
			setAbortController(sessionId, null);
		}
	}
}
