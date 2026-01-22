import { query } from "@anthropic-ai/claude-agent-sdk";

export async function* sendMessage(message: string): AsyncGenerator<string> {
	console.log(`Sending: ${message.slice(0, 50)}...`);

	for await (const event of query({
		prompt: message,
		options: {
			systemPrompt: {
				type: "preset",
				preset: "claude_code",
				append: "Your reponses must always be accurate and concise.",
			},
			model: "claude-haiku-4-5",
			permissionMode: "bypassPermissions",
			allowDangerouslySkipPermissions: true,
			includePartialMessages: true,
			continue: true, // Always continue most recent session
		},
	})) {
		yield JSON.stringify(event);
	}
}

export function clearSession(): void {
	// TODO: Need SDK support to clear/start fresh session
}
