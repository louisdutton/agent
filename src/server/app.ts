// Elysia API app - composes route plugins

import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { initAssistant } from "./assistant";
import { audioRoutes } from "./routes/audio";
import { automationsRoutes, webhookTriggerRoutes } from "./routes/automations";
import { configRoutes } from "./routes/config";
import { filesRoutes } from "./routes/files";
import { gitRoutes } from "./routes/git";
import { projectsRoutes } from "./routes/projects";
import { sessionsRoutes } from "./routes/sessions";
import { initScheduler, startScheduler } from "./scheduler";

// Initialize assistant and scheduler on startup
Promise.all([initAssistant(), initScheduler()]).then(() => {
	startScheduler();
	console.log("Assistant and scheduler initialized");
});

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
	.use(projectsRoutes)
	.use(automationsRoutes)
	.use(configRoutes)
	.use(webhookTriggerRoutes);

// Export type for Eden treaty
export type App = typeof app;
