// Elysia API app - composes route plugins

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { audioRoutes } from "./routes/audio";
import { filesRoutes } from "./routes/files";
import { gitRoutes } from "./routes/git";
import { projectsRoutes } from "./routes/projects";
import { sessionsRoutes } from "./routes/sessions";

export const app = new Elysia({ prefix: "/api" })
	.use(cors())
	.get("/info", () => ({
		cwd: process.cwd(),
		version: "2.0.0",
	}))
	.use(sessionsRoutes)
	.use(audioRoutes)
	.use(gitRoutes)
	.use(filesRoutes)
	.use(projectsRoutes);

// Export type for Eden treaty
export type App = typeof app;
