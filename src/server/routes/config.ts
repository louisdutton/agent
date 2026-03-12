// Config API routes

import { Elysia, t } from "elysia";
import { getConfig, resetConfig, updateConfig } from "../config";

const configSchema = t.Object({
	model: t.Optional(t.String()),
	autoApproveTools: t.Optional(t.Array(t.String())),
	maxConcurrentSessions: t.Optional(t.Number()),
	requireApproval: t.Optional(t.Boolean()),
});

export const configRoutes = new Elysia({ prefix: "/config" })
	.get("/", () => getConfig())
	.patch("/", ({ body }) => updateConfig(body), { body: configSchema })
	.post("/reset", () => resetConfig());
