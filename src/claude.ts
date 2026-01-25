import { query } from "@anthropic-ai/claude-agent-sdk";
import {
	getActiveSession,
	getActiveSessionCwd,
	getOrCreateSession,
	setAbortController,
} from "./session";

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
			yield JSON.stringify(event);
		}
	} finally {
		if (sessionId) {
			setAbortController(sessionId, null);
		}
	}
}
