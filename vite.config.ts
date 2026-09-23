import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// CF_PERSIST lets parallel dev servers keep separate local D1/DO/KV state (e.g. CF_PERSIST=.wrangler/state-teams).
const persistPath = process.env.CF_PERSIST;

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare(persistPath ? { persistState: { path: persistPath } } : {})],
});
