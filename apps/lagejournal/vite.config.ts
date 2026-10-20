import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// GitHub Pages: https://bubavanhalen.github.io/lage-tools/lagejournal/
export default defineConfig({ base: "./", plugins: [react()], build: { outDir: "dist", sourcemap: true } });
