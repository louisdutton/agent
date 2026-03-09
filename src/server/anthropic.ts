// Anthropic API client - uses API key from env or Claude Code credentials

import { homedir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

export type Model = "claude-3-5-haiku-latest" | "claude-3-5-sonnet-latest";

export type Message = {
	role: "user" | "assistant";
	content: string;
};

export type CompletionOptions = {
	model?: Model;
	maxTokens?: number;
	system?: string;
};

type Credentials = {
	claudeAiOauth?: {
		accessToken: string;
	};
};

// Cache the client
let cachedClient: Anthropic | null = null;

/**
 * Get or create an Anthropic client
 * Priority: ANTHROPIC_API_KEY env > OAuth token from Claude Code
 */
async function getClient(): Promise<Anthropic | null> {
	if (cachedClient) {
		return cachedClient;
	}

	// First try env API key
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (apiKey) {
		cachedClient = new Anthropic({ apiKey });
		return cachedClient;
	}

	// Fall back to OAuth token (will fail until Anthropic adds support)
	try {
		const file = Bun.file(CREDENTIALS_PATH);
		if (!(await file.exists())) {
			return null;
		}
		const creds = (await file.json()) as Credentials;
		const accessToken = creds.claudeAiOauth?.accessToken;

		if (!accessToken) {
			return null;
		}

		cachedClient = new Anthropic({
			authToken: accessToken,
		});

		return cachedClient;
	} catch {
		return null;
	}
}

/**
 * Get a completion from the Anthropic API
 */
export async function complete(
	messages: Message[],
	options: CompletionOptions = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const client = await getClient();

	if (!client) {
		return {
			ok: false,
			error: "No API key found. Set ANTHROPIC_API_KEY environment variable.",
		};
	}

	const {
		model = "claude-3-5-haiku-latest",
		maxTokens = 256,
		system,
	} = options;

	try {
		const response = await client.messages.create({
			model,
			max_tokens: maxTokens,
			system,
			messages,
		});

		const text = response.content?.[0];
		if (text?.type !== "text" || !text.text) {
			return { ok: false, error: "Empty response from API" };
		}

		return { ok: true, text: text.text.trim() };
	} catch (err) {
		// Clear cached client on auth error
		if (err instanceof Error && err.message.includes("authentication")) {
			cachedClient = null;
		}
		return { ok: false, error: String(err) };
	}
}

/**
 * Simple single-prompt completion
 */
export async function prompt(
	userPrompt: string,
	options: CompletionOptions = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	return complete([{ role: "user", content: userPrompt }], options);
}
