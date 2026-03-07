// URL-based routing - single source of truth
import { createSignal } from "solid-js";

export type LocationParams = {
	sessionId: string | null;
	project: string | null;
	taskId: string | null;
};

// View type derived from URL params
export type ViewType =
	| { type: "home" }
	| { type: "session"; project: string; sessionId: string | null }
	| { type: "task"; taskId: string };

export function getViewType(loc: LocationParams): ViewType {
	if (loc.taskId) {
		return { type: "task", taskId: loc.taskId };
	}
	if (loc.project) {
		return { type: "session", project: loc.project, sessionId: loc.sessionId };
	}
	return { type: "home" };
}

function getParams(): LocationParams {
	const url = new URL(window.location.href);
	return {
		sessionId: url.searchParams.get("session"),
		project: url.searchParams.get("project"),
		taskId: url.searchParams.get("task"),
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

export type NavigateParams =
	| { type: "home" }
	| { type: "session"; project: string; sessionId?: string | null }
	| { type: "task"; taskId: string };

export function navigate(params: NavigateParams) {
	const url = new URL(window.location.href);

	// Clear all nav params first
	url.searchParams.delete("session");
	url.searchParams.delete("project");
	url.searchParams.delete("task");

	// Set params based on type
	if (params.type === "session") {
		url.searchParams.set("project", params.project);
		if (params.sessionId) {
			url.searchParams.set("session", params.sessionId);
		}
	} else if (params.type === "task") {
		url.searchParams.set("task", params.taskId);
	}
	// type === "home" leaves all params cleared

	window.history.pushState({}, "", url.toString());
	window.dispatchEvent(new PopStateEvent("popstate"));
}

// Helper to build URL with project query param
export function apiUrl(path: string, projectPath: string): string {
	const separator = path.includes("?") ? "&" : "?";
	return `${path}${separator}project=${encodeURIComponent(projectPath)}`;
}
