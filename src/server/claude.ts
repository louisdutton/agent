import { query } from "@anthropic-ai/claude-agent-sdk";
import { getCwd, setAbortController } from "./session";

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
): AsyncGenerator<string> {
	console.debug(`Sending: ${message.slice(0, 50)}...`);

	const cwd = getCwd();
	const abortController = new AbortController();
	setAbortController(abortController);

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

		for await (const event of query({
			prompt: message,
			options,
		})) {
			yield JSON.stringify(event);
		}
	} finally {
		setAbortController(null);
	}
}
