import { defineConfig } from "vite";
import { fullstack } from "@opentyped/vite-express-rsc";

export default defineConfig({
  plugins: [
    fullstack({
      entry: "./examples/basic/src/index.ts",
      directory: "./examples/basic/src/app",
    }),
  ],
});
