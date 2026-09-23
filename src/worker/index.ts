// Worker entry: mounts API sub-apps, exports the DraftRoom Durable Object and the cron handler.
// Static assets (the React app and /data/*.json) are served by Workers Static Assets before this runs.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError, errorBody, type AppEnv } from "./lib/http";
import { teamsApp } from "./teams";
import { roomsApp } from "./rooms";
import { coachApp } from "./coach";
import { liveApp, runScheduled } from "./live";
import { runMaintenance } from "./maintenance";

export { DraftRoom } from "./rooms/DraftRoom";

const app = new Hono<AppEnv>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route("/", teamsApp);
app.route("/", roomsApp);
app.route("/", coachApp);
app.route("/", liveApp);

app.notFound((c) => c.json(errorBody("not_found", "No such endpoint."), 404));
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
  if (err instanceof HTTPException) return c.json(errorBody("http_error", err.message), err.status);
  console.error("unhandled", err);
  return c.json(errorBody("internal", "Something went wrong."), 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduled(env, controller));
    ctx.waitUntil(runMaintenance(env, controller.scheduledTime || Date.now()));
  },
} satisfies ExportedHandler<Env>;
