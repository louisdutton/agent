// Client-side utility functions

/**
 * Result type for operations that can fail.
 * First element is the data (or null on error), second is the error (or null on success).
 */
export type Result<T, E = Error> = [T, null] | [null, E];

/**
 * Safely parse JSON, returning a Result tuple.
 */
export function parseJSON<T = Record<string, unknown>>(
	data: string,
): Result<T> {
	try {
		return [JSON.parse(data) as T, null];
	} catch (err) {
		return [null, err as Error];
	}
}

/**
 * Parse SSE data line, stripping the "data: " prefix if present.
 * Returns null for empty lines or [DONE] markers.
 */
export function parseSSELine(line: string): string | null {
	const data = line.startsWith("data: ") ? line.slice(6) : line;
	if (!data || data === "[DONE]") return null;
	return data;
}
