import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Elysia, t } from "elysia";

const projectQuery = t.Object({ project: t.String() });

export const filesRoutes = new Elysia()
	.get(
		"/files",
		async ({ query }) => {
			const relativePath = query.path || "";
			const fullPath = relativePath
				? join(query.project, relativePath)
				: query.project;

			const entries = await readdir(fullPath, { withFileTypes: true });
			const visibleEntries = entries.filter((e) => !e.name.startsWith("."));

			const pathsToCheck = visibleEntries.map((e) =>
				relativePath ? `${relativePath}/${e.name}` : e.name,
			);

			const ignoredSet = new Set<string>();
			if (pathsToCheck.length > 0) {
				const checkIgnoreProc = Bun.spawn(["git", "check-ignore", "--stdin"], {
					cwd: query.project,
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
				});
				checkIgnoreProc.stdin.write(pathsToCheck.join("\n"));
				checkIgnoreProc.stdin.end();
				const ignoredOutput = await new Response(checkIgnoreProc.stdout).text();
				await checkIgnoreProc.exited;

				for (const line of ignoredOutput.trim().split("\n")) {
					if (line) ignoredSet.add(line);
				}
			}

			const files = visibleEntries
				.filter((e) => {
					const entryPath = relativePath ? `${relativePath}/${e.name}` : e.name;
					return !ignoredSet.has(entryPath);
				})
				.map((e) => ({
					name: e.name,
					path: relativePath ? `${relativePath}/${e.name}` : e.name,
					isDirectory: e.isDirectory(),
				}))
				.sort((a, b) => {
					if (a.isDirectory !== b.isDirectory) {
						return a.isDirectory ? -1 : 1;
					}
					return a.name.localeCompare(b.name);
				});

			return { files, path: relativePath };
		},
		{ query: t.Object({ project: t.String(), path: t.Optional(t.String()) }) },
	)

	.get(
		"/file/*",
		async ({ params, query, status }) => {
			const filePath = params["*"];
			const fullPath = filePath.startsWith("/")
				? filePath
				: join(query.project, filePath);

			const file = Bun.file(fullPath);
			if (!(await file.exists())) {
				return status(404, "File not found");
			}

			const content = await file.text();
			return { content, path: fullPath };
		},
		{ query: projectQuery },
	);
