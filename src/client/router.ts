// URL-based routing - single source of truth
import { createSignal } from "solid-js";

export type LocationParams = {
	sessionId: string | null;
	project: string | null;
};

function getParams(): LocationParams {
	const url = new URL(window.location.href);
	return {
		sessionId: url.searchParams.get("session"),
		project: url.searchParams.get("project"),
	};
}

// Global location signal - shared across all useLocation calls
const [location, setLocation] = createSignal(getParams());

// Set up listener once at module load
if (typeof window !== "undefined") {
	window.addEventListener("popstate", () => setLocation(getParams()));
}

export function useLocation() {
	return location;
}

export function navigate(sessionId: string | null, project: string | null) {
	const url = new URL(window.location.href);
	if (sessionId && project) {
		url.searchParams.set("session", sessionId);
		url.searchParams.set("project", project);
	} else {
		url.searchParams.delete("session");
		url.searchParams.delete("project");
	}
	window.history.pushState({}, "", url.toString());
	// Trigger reactivity by dispatching popstate
	window.dispatchEvent(new PopStateEvent("popstate"));
}

// Helper to build URL with project query param
export function apiUrl(path: string, projectPath: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}project=${encodeURIComponent(projectPath)}`;
}
