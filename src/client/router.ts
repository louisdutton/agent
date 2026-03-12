// URL-based routing - single source of truth
import { createSignal } from "solid-js";

export type LocationParams = {
	sessionId: string | null;
	project: string | null;
	taskId: string | null;
	page: string | null;
};

// View type derived from URL params
export type ViewType =
	| { type: "home" }
	| { type: "chat"; project: string; sessionId: string | null }
	| { type: "tasks" }
	| { type: "schedules" }
	| { type: "webhooks" }
	| { type: "history" }
	| { type: "settings" }
	| { type: "task"; taskId: string };

export function getViewType(loc: LocationParams): ViewType {
	// Check for page param first
	if (loc.page) {
		switch (loc.page) {
			case "schedules":
				return { type: "schedules" };
			case "tasks":
				return { type: "tasks" };
			case "webhooks":
				return { type: "webhooks" };
			case "history":
				return { type: "history" };
			case "settings":
				return { type: "settings" };
		}
	}
	if (loc.taskId) {
		return { type: "task", taskId: loc.taskId };
	}
	if (loc.project) {
		return { type: "chat", project: loc.project, sessionId: loc.sessionId };
	}
	return { type: "home" };
}

function getParams(): LocationParams {
	const url = new URL(window.location.href);
	return {
		sessionId: url.searchParams.get("session"),
		project: url.searchParams.get("project"),
		taskId: url.searchParams.get("task"),
		page: url.searchParams.get("page"),
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
	| { type: "chat"; project: string; sessionId?: string | null }
	| { type: "task"; taskId: string }
	| { type: "tasks" }
	| { type: "schedules" }
	| { type: "webhooks" }
	| { type: "history" }
	| { type: "settings" };

export function navigate(params: NavigateParams) {
	const url = new URL(window.location.href);

	// Clear all nav params first
	url.searchParams.delete("session");
	url.searchParams.delete("project");
	url.searchParams.delete("task");
	url.searchParams.delete("page");

	// Set params based on type
	if (params.type === "chat") {
		url.searchParams.set("project", params.project);
		if (params.sessionId) {
			url.searchParams.set("session", params.sessionId);
		}
	} else if (params.type === "task") {
		url.searchParams.set("task", params.taskId);
	} else if (
		params.type === "tasks" ||
		params.type === "schedules" ||
		params.type === "webhooks" ||
		params.type === "history" ||
		params.type === "settings"
	) {
		url.searchParams.set("page", params.type);
	}
	// type === "home" leaves all params cleared

	window.history.pushState({}, "", url.toString());
	window.dispatchEvent(new PopStateEvent("popstate"));
}
