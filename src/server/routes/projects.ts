import { homedir } from "node:os";
import { join } from "node:path";
import { Elysia, t } from "elysia";
import { listProjects } from "../files";

export const projectsRoutes = new Elysia({ prefix: "/projects" })
	.get("/", async () => {
		const projects = await listProjects();
		return { projects };
	})

	.post(
		"/validate",
		async ({ body }) => {
			const projectPath = join(homedir(), "projects", body.project);
			const proc = Bun.spawn(["test", "-d", projectPath]);
			if ((await proc.exited) !== 0) {
				return { error: "Project not found" };
			}
			return { ok: true, projectPath };
		},
		{ body: t.Object({ project: t.String() }) },
	);
