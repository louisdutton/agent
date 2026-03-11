// Provider factory and re-exports

export { createAnthropicProvider } from "./anthropic";
export * from "./types";

import { createAnthropicProvider } from "./anthropic";
import type { Provider, ProviderConfig } from "./types";

export type ProviderName = "anthropic" | "openai";

export function createProvider(
	name: ProviderName,
	config: ProviderConfig = {},
): Provider {
	switch (name) {
		case "anthropic":
			return createAnthropicProvider(config);
		case "openai":
			throw new Error("OpenAI provider not yet implemented");
		default:
			throw new Error(`Unknown provider: ${name}`);
	}
}

// Auto-detect provider from model name
export function detectProvider(model: string): ProviderName {
	if (model.startsWith("claude")) return "anthropic";
	if (
		model.startsWith("gpt") ||
		model.startsWith("o1") ||
		model.startsWith("o3")
	)
		return "openai";
	return "anthropic"; // Default
}
