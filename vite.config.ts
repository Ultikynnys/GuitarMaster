import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getVersion } from "./scripts/version.ts";

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(getVersion()),
  },
});
