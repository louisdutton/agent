import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { getSessionsFromTranscripts } from "./session";

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
		gitBranch?: string;
	};
	type ProjectWithSessions = {
		name: string;
		path: string;
		sessions: SessionInfo[];
	};

	const projects: ProjectWithSessions[] = [];

	for (const name of projectNames) {
		const projectPath = join(projectsDir, name);

		const projectData: ProjectWithSessions = {
			name,
			path: projectPath,
			sessions: [],
		};

		try {
			const allSessions = await getSessionsFromTranscripts(projectPath);
			projectData.sessions = allSessions
				.filter((e) => !e.isSidechain)
				.sort(
					(a, b) =>
						new Date(b.modified).getTime() - new Date(a.modified).getTime(),
				)
				.map((e) => ({
					sessionId: e.sessionId,
					firstPrompt: e.firstPrompt || "Untitled session",
					created: e.created,
					modified: e.modified,
					gitBranch: e.gitBranch,
				}));
		} catch {
			// No sessions for this project
		}

		projects.push(projectData);
	}

	return projects;
}
