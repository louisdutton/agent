// URL-based routing - single source of truth
import { createSignal, onCleanup, onMount } from "solid-js";

export type LocationParams = {
	sessionId: string | null;
	project: string | null;
};

export function useLocation() {
	const getParams = (): LocationParams => {
		const url = new URL(window.location.href);
		return {
			sessionId: url.searchParams.get("session"),
			project: url.searchParams.get("project"),
		};
	};

	const [location, setLocation] = createSignal(getParams());

	onMount(() => {
		const handlePopState = () => setLocation(getParams());
		window.addEventListener("popstate", handlePopState);
		onCleanup(() => window.removeEventListener("popstate", handlePopState));
	});

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
