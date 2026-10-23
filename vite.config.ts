import { defineConfig } from "vite";
import { expressRsc } from "@opentyped/vite-express-rsc";

export default defineConfig({
  build: { rollupOptions: { input: "./tests/fixture/src/index.ts" } },
  plugins: [
    expressRsc({
      directory: "./tests/fixture/src/app",
    }),
  ],
});
