import { query } from "@anthropic-ai/claude-agent-sdk";

// Store session ID for conversation persistence
let currentSessionId: string | undefined;

export async function* sendMessage(message: string): AsyncGenerator<string> {
  console.log(`Sending: ${message.slice(0, 50)}... (session: ${currentSessionId ?? 'new'})`);

  for await (const event of query({
    prompt: message,
    options: {
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: 'Your reponses must always be accurate and concise.'
      },
      model: 'claude-haiku-4-5',
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      ...(currentSessionId && { resume: currentSessionId }),
    },
  })) {
    // Capture session ID from init message
    if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
      currentSessionId = event.session_id;
      console.log(`Session ID: ${currentSessionId}`);
    }
    yield JSON.stringify(event);
  }
}

export function clearSession(): void {
  currentSessionId = undefined;
}
