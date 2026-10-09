import { defineConfig } from "vite";
import { lorcaTailwind } from "./scripts/tailwind.ts";

export default defineConfig({
  base: "./",
  plugins: [lorcaTailwind()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", port: 5178, strictPort: true, hmr: false },
  build: { outDir: "dist", sourcemap: false },
});
