// Global session state - tracks active sessions and approval queue across the app

import { createSignal } from "solid-js";
import type { ApprovalRequest, SessionStatus } from "../server/wire/types";

export type ActiveSession = {
	id: string;
	projectPath: string;
	projectName: string;
	status: SessionStatus;
	title?: string;
};

export type QueuedApproval = {
	sessionId: string;
	projectPath: string;
	projectName: string;
	request: ApprovalRequest;
};

const [activeSessions, setActiveSessions] = createSignal<
	Map<string, ActiveSession>
>(new Map());
const [approvalQueue, setApprovalQueue] = createSignal<QueuedApproval[]>([]);

export { activeSessions, approvalQueue, setActiveSessions, setApprovalQueue };

// Helper to extract project name from path
export function getProjectName(projectPath: string): string {
	return projectPath.split("/").pop() || projectPath;
}

// Update a session in the active sessions map
export function updateActiveSession(
	sessionId: string,
	projectPath: string,
	status: SessionStatus,
	title?: string,
): void {
	setActiveSessions((prev) => {
		const next = new Map(prev);
		if (status === "completed" || status === "error") {
			// Remove completed/errored sessions after a delay
			setTimeout(() => {
				setActiveSessions((p) => {
					const n = new Map(p);
					n.delete(sessionId);
					return n;
				});
			}, 5000);
		}
		next.set(sessionId, {
			id: sessionId,
			projectPath,
			projectName: getProjectName(projectPath),
			status,
			title,
		});
		return next;
	});
}

// Add approval to queue
export function addApprovalToQueue(
	sessionId: string,
	projectPath: string,
	request: ApprovalRequest,
): void {
	setApprovalQueue((prev) => [
		...prev,
		{
			sessionId,
			projectPath,
			projectName: getProjectName(projectPath),
			request,
		},
	]);
}

// Remove approval from queue
export function removeApprovalFromQueue(requestId: string): void {
	setApprovalQueue((prev) => prev.filter((a) => a.request.id !== requestId));
}
