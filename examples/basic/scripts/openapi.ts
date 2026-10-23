// Generate openapi.json and openapi.d.ts from the route directory's annotated handlers.
// The parser reads source code only; it never imports or runs the application.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generate } from "@opentyped/oapi-compiler";
import { generateDefinitions } from "@opentyped/oapi-tsgen";
import {
  defaultParsers,
  filesystemParsers,
} from "@opentyped/vite-express-rsc-oapi";

const root = resolve(import.meta.dirname, "..");
const { document } = generate(
  {
    root,
    tsconfig: "tsconfig.json",
    info: { title: "Todos", version: "1.0.0" },
    parsers: filesystemParsers({ directory: "src/app" }, defaultParsers()),
  },
  defaultParsers,
);

writeFileSync(
  resolve(root, "openapi.json"),
  JSON.stringify(document, null, 2) + "\n",
);
writeFileSync(resolve(root, "openapi.d.ts"), generateDefinitions(document));
console.log(
  `Wrote ${Object.keys(document.paths).length} paths to openapi.json`,
);
