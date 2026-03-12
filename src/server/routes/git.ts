import { join } from "node:path";
import { Elysia, t } from "elysia";
import {
	autoCommit,
	createBranch,
	deleteBranch,
	getBranches,
	getCommitDetails,
	getCurrentBranch,
	getGitFiles,
	getGitLog,
	getStashes,
	gitCherryPick,
	gitFetch,
	gitPull,
	gitPush,
	gitReset,
	gitRevert,
	mergeBranch,
	stashApply,
	stashDrop,
	stashPop,
	stashSave,
	switchBranch,
} from "../git/git";

const projectQuery = t.Object({ project: t.String() });

export const gitRoutes = new Elysia({ prefix: "/git" })
	.get(
		"/status",
		async ({ query }) => {
			const projectPath = query.project;
			const diffProc = Bun.spawn(["git", "diff", "--numstat"], {
				cwd: projectPath,
				stdout: "pipe",
				stderr: "pipe",
			});

			const diffOutput = await new Response(diffProc.stdout).text();
			await diffProc.exited;

			let insertions = 0;
			let deletions = 0;
			let filesChanged = 0;

			for (const line of diffOutput.trim().split("\n")) {
				if (!line) continue;
				const [added, removed] = line.split("\t");
				if (added !== "-") insertions += Number.parseInt(added, 10) || 0;
				if (removed !== "-") deletions += Number.parseInt(removed, 10) || 0;
				filesChanged++;
			}

			const untrackedProc = Bun.spawn(
				["git", "ls-files", "--others", "--exclude-standard"],
				{ cwd: projectPath, stdout: "pipe", stderr: "pipe" },
			);
			const untrackedOutput = await new Response(untrackedProc.stdout).text();
			await untrackedProc.exited;

			const untrackedFiles = untrackedOutput.trim().split("\n").filter(Boolean);
			filesChanged += untrackedFiles.length;

			const lineCounts = await Promise.all(
				untrackedFiles.map(async (filePath) => {
					try {
						const file = Bun.file(join(projectPath, filePath));
						if (await file.exists()) {
							const content = await file.text();
							return content.split("\n").length;
						}
					} catch {
						// Skip files we can't read
					}
					return 0;
				}),
			);
			insertions += lineCounts.reduce((a, b) => a + b, 0);

			return {
				hasChanges: filesChanged > 0,
				insertions,
				deletions,
				filesChanged,
			};
		},
		{ query: projectQuery },
	)

	.get(
		"/diff",
		async ({ query }) => {
			const files = await getGitFiles(query.project);
			return { files };
		},
		{ query: projectQuery },
	)

	.post(
		"/commit",
		async ({ query, body }) => {
			const message = body?.message?.trim();
			if (!message) {
				const result = await autoCommit(query.project);
				if (result.ok) {
					return { ok: true, message: result.message };
				}
				return { ok: false, error: result.error };
			}

			const addProc = Bun.spawn(["git", "add", "-A"], {
				cwd: query.project,
				stdout: "pipe",
				stderr: "pipe",
			});
			await addProc.exited;

			const commitProc = Bun.spawn(["git", "commit", "-m", message], {
				cwd: query.project,
				stdout: "pipe",
				stderr: "pipe",
			});

			const stderr = await new Response(commitProc.stderr).text();
			const exitCode = await commitProc.exited;

			if (exitCode !== 0) {
				return { ok: false, error: stderr || "Commit failed" };
			}

			return { ok: true, message };
		},
		{
			query: projectQuery,
			body: t.Optional(t.Object({ message: t.Optional(t.String()) })),
		},
	)

	.get(
		"/log",
		async ({ query }) => {
			const count = query.count ? Number.parseInt(query.count, 10) : 50;
			const commits = await getGitLog(query.project, count, query.branch);
			const currentBranch = await getCurrentBranch(query.project);
			return { commits, currentBranch };
		},
		{
			query: t.Object({
				project: t.String(),
				count: t.Optional(t.String()),
				branch: t.Optional(t.String()),
			}),
		},
	)

	.get(
		"/commits/:hash",
		async ({ params, query }) => {
			return await getCommitDetails(query.project, params.hash);
		},
		{ query: projectQuery },
	)

	.get(
		"/branches",
		async ({ query }) => {
			const branches = await getBranches(query.project);
			const current = await getCurrentBranch(query.project);
			return { branches, current };
		},
		{ query: projectQuery },
	)

	.post(
		"/branches",
		async ({ query, body }) => {
			await createBranch(query.project, body.name.trim(), body.startPoint);
			return { ok: true };
		},
		{
			query: projectQuery,
			body: t.Object({
				name: t.String(),
				startPoint: t.Optional(t.String()),
			}),
		},
	)

	.delete(
		"/branches/:name",
		async ({ params, query }) => {
			const force = query.force === "true";
			await deleteBranch(query.project, decodeURIComponent(params.name), force);
			return { ok: true };
		},
		{ query: t.Object({ project: t.String(), force: t.Optional(t.String()) }) },
	)

	.post(
		"/checkout",
		async ({ query, body }) => {
			await switchBranch(query.project, body.branch.trim());
			return { ok: true };
		},
		{ query: projectQuery, body: t.Object({ branch: t.String() }) },
	)

	.post(
		"/merge",
		async ({ query, body }) => {
			const output = await mergeBranch(query.project, body.branch.trim());
			return { ok: true, output };
		},
		{ query: projectQuery, body: t.Object({ branch: t.String() }) },
	)

	.get(
		"/stashes",
		async ({ query }) => {
			const stashes = await getStashes(query.project);
			return { stashes };
		},
		{ query: projectQuery },
	)

	.post(
		"/stashes",
		async ({ query, body }) => {
			await stashSave(query.project, body.message);
			return { ok: true };
		},
		{
			query: projectQuery,
			body: t.Object({ message: t.Optional(t.String()) }),
		},
	)

	.post(
		"/stashes/:index",
		async ({ params, query, body }) => {
			const index = Number.parseInt(params.index, 10);
			if (body.action === "pop") {
				await stashPop(query.project, index);
			} else if (body.action === "apply") {
				await stashApply(query.project, index);
			} else if (body.action === "drop") {
				await stashDrop(query.project, index);
			}
			return { ok: true };
		},
		{
			query: projectQuery,
			body: t.Object({
				action: t.Union([
					t.Literal("pop"),
					t.Literal("apply"),
					t.Literal("drop"),
				]),
			}),
		},
	)

	.post(
		"/pull",
		async ({ query }) => {
			const output = await gitPull(query.project);
			return { ok: true, output };
		},
		{ query: projectQuery },
	)

	.post(
		"/push",
		async ({ query, body }) => {
			const output = await gitPush(query.project, body.force, body.setUpstream);
			return { ok: true, output };
		},
		{
			query: projectQuery,
			body: t.Object({
				force: t.Optional(t.Boolean()),
				setUpstream: t.Optional(t.Boolean()),
			}),
		},
	)

	.post(
		"/fetch",
		async ({ query }) => {
			const output = await gitFetch(query.project);
			return { ok: true, output };
		},
		{ query: projectQuery },
	)

	.post(
		"/reset",
		async ({ query, body }) => {
			await gitReset(query.project, body.hash.trim(), body.mode || "mixed");
			return { ok: true };
		},
		{
			query: projectQuery,
			body: t.Object({
				hash: t.String(),
				mode: t.Optional(
					t.Union([t.Literal("soft"), t.Literal("mixed"), t.Literal("hard")]),
				),
			}),
		},
	)

	.post(
		"/cherry-pick",
		async ({ query, body }) => {
			const output = await gitCherryPick(query.project, body.hash.trim());
			return { ok: true, output };
		},
		{ query: projectQuery, body: t.Object({ hash: t.String() }) },
	)

	.post(
		"/revert",
		async ({ query, body }) => {
			const output = await gitRevert(query.project, body.hash.trim());
			return { ok: true, output };
		},
		{ query: projectQuery, body: t.Object({ hash: t.String() }) },
	);
