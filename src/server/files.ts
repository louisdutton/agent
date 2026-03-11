import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getSessionManager } from "./agent";

export const PROJECTS_DIR = join(homedir(), "projects");

export async function listProjects() {
	const projectsDir = PROJECTS_DIR;
	const fdOutput =
		await $`fd --type d --hidden --no-ignore ^.git$ ${projectsDir}`.text();

	const projectPaths = fdOutput
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((gitDir) => gitDir.replace(/\/.git\/?$/, ""));

	const projectNames = projectPaths
		.map((p) => p.replace(`${projectsDir}/`, ""))
		.sort((a, b) => a.localeCompare(b));

	type SessionInfo = {
		sessionId: string;
		firstPrompt: string;
		created: string;
		modified: string;
	};
	type ProjectWithSessions = {
		name: string;
		path: string;
		sessions: SessionInfo[];
	};

	const projects: ProjectWithSessions[] = [];
	const manager = getSessionManager();

	for (const name of projectNames) {
		const projectPath = join(projectsDir, name);

		const projectData: ProjectWithSessions = {
			name,
			path: projectPath,
			sessions: [],
		};

		try {
			const sessions = await manager.listFromDisk(projectPath);
			projectData.sessions = sessions.map((s) => ({
				sessionId: s.sessionId,
				firstPrompt: s.title,
				created: new Date(s.createdAt).toISOString(),
				modified: new Date(s.updatedAt).toISOString(),
			}));
		} catch {
			// No sessions for this project
		}

		projects.push(projectData);
	}

	return projects;
}
