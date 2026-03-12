export const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

// Helper to create JSON response with CORS headers
export const json = (data: unknown, init?: ResponseInit) =>
	Response.json(data, {
		...init,
		headers: { ...corsHeaders, ...init?.headers },
	});

export const error = (message: string, status = 500) =>
	json({ error: message }, { status });

export const EMPTY = new Response(null, { headers: corsHeaders });

/**
 * Convert a callback-based subscription to an async generator.
 * Used for streaming SSE events from session/task subscriptions.
 */
export async function* subscriptionToGenerator<T>(
	subscribe: (
		callback: (event: T) => void,
		options: { replay: boolean },
	) => () => void,
	isTerminal: (event: T) => boolean,
): AsyncGenerator<T> {
	const queue: T[] = [];
	let resolve: (() => void) | null = null;
	let done = false;

	const unsubscribe = subscribe(
		(event) => {
			queue.push(event);
			if (isTerminal(event)) done = true;
			resolve?.();
		},
		{ replay: true },
	);

	try {
		while (!done || queue.length > 0) {
			if (queue.length > 0) {
				const item = queue.shift();
				if (item !== undefined) yield item;
			} else {
				await new Promise<void>((r) => {
					resolve = r;
				});
			}
		}
	} finally {
		unsubscribe();
	}
}
