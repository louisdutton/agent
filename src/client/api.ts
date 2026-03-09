// Eden treaty client - fully typed API calls
import { treaty } from "@elysiajs/eden";
import type { App } from "../server/app";

// Create treaty client pointing to current origin
const client = treaty<App>(window.location.origin);

// Export the /api group directly to avoid client.api.api paths
export const api = client.api;

// Re-export for convenience
export type { App };
