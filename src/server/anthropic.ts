// Simple Anthropic API client for one-off completions (used by git auto-commit)

import { homedir } from "node:os";
import { join } from "node:path";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

type Credentials = {
	claudeAiOauth?: {
		accessToken: string;
	};
};

type AuthConfig =
	| { type: "apiKey"; apiKey: string }
	| { type: "oauth"; token: string };

// Get auth config (API key or OAuth token)
async function getAuth(): Promise<AuthConfig | null> {
	// Try API key first
	const apiKey = process.env.ANTHROPIC_API_KEY;
	if (apiKey) {
		return { type: "apiKey", apiKey };
	}

	// Fall back to OAuth token
	try {
		const file = Bun.file(CREDENTIALS_PATH);
		if (!(await file.exists())) return null;
		const creds = (await file.json()) as Credentials;
		const token = creds.claudeAiOauth?.accessToken;
		if (token) {
			return { type: "oauth", token };
		}
	} catch {
		// Ignore
	}

	return null;
}

// Build headers for Anthropic API
function buildHeaders(auth: AuthConfig): Record<string, string> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"anthropic-version": "2023-06-01",
	};

	if (auth.type === "apiKey") {
		headers["x-api-key"] = auth.apiKey;
	} else {
		headers["Authorization"] = `Bearer ${auth.token}`;
		headers["anthropic-beta"] = "oauth-2025-04-20";
	}

	return headers;
}

/**
 * Simple single-prompt completion using Haiku (fast/cheap)
 */
export async function prompt(
	userPrompt: string,
	options: { model?: string; maxTokens?: number; system?: string } = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
	const auth = await getAuth();
	if (!auth) {
		return {
			ok: false,
			error:
				"No API key found. Set ANTHROPIC_API_KEY or login with Claude Code.",
		};
	}

	const {
		model = "claude-3-5-haiku-latest",
		maxTokens = 256,
		system,
	} = options;

	try {
		const body: Record<string, unknown> = {
			model,
			max_tokens: maxTokens,
			messages: [{ role: "user", content: userPrompt }],
		};

		if (system) {
			body.system = system;
		}

		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: buildHeaders(auth),
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const errorText = await response.text();
			return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
		};

		const text = data.content?.[0];
		if (text?.type !== "text" || !text.text) {
			return { ok: false, error: "Empty response from API" };
		}

		return { ok: true, text: text.text.trim() };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}
