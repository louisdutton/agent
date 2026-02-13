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
