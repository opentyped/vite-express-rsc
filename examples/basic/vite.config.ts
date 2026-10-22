import { defineConfig } from "vite";
import { fullstack } from "@opentyped/vite-express-rsc";

export default defineConfig({
  plugins: [
    fullstack({
      entry: "./src/index.ts",
      directory: "./src/app",
    }),
  ],
});
