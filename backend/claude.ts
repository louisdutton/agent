import { query } from "@anthropic-ai/claude-agent-sdk";

export async function* sendMessage(message: string): AsyncGenerator<string> {
  console.log(`Sending: ${message.slice(0, 50)}...`);

  for await (const event of query({
    prompt: message,
    options: {
      model: 'claude-haiku-4-5',
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
    },
  })) {
    yield JSON.stringify(event);
  }
}
