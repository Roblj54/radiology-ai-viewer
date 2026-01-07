import { defineConfig } from "vite";

export default defineConfig({
  base: "/radiology-ai-viewer/",
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  esbuild: { jsx: "automatic" }
});