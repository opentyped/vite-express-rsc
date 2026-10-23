import { defineConfig } from "vite";
import { expressRsc } from "@opentyped/vite-express-rsc";

export default defineConfig({
  plugins: [expressRsc({ directory: "./src/app" })],
});
