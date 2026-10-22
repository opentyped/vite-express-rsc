import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import rsc, { getPluginApi } from "@vitejs/plugin-rsc";
import { definitions } from "./routes.js";

const runtime = (file: string) =>
  fileURLToPath(new URL("./runtime/" + file, import.meta.url));

export interface FullstackOptions {
  /** Application-owned Express entry, compiled with ordinary Node/React conditions. */
  entry: string;
  /**
   * One filesystem tree containing pages, layouts, middleware, and native endpoints.
   */
  directory: string;
}

/** Compile the Express entry and the RSC, HTML, and browser module graphs together. */
export function fullstack(options: FullstackOptions): PluginOption[] {
  if (!options?.entry || !options?.directory) {
    throw new Error(
      "fullstack requires { entry, directory }; app/api directories were replaced by one convention tree",
    );
  }

  let root: string, directory: string, entry: string;
  let config: ResolvedConfig;
  const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const plugin: Plugin = {
    name: "express-rsc:conventions",
    enforce: "pre",
    config(config) {
      root = resolve(config.root || process.cwd());
      directory = resolve(root, options.directory);
      entry = resolve(root, options.entry);

      return {
        environments: {
          rsc: {
            resolve: {
              noExternal: [
                "react-router",
                "@opentyped/vite-express-rsc",
                "@remix-run/node-fetch-server",
                "set-cookie-parser",
              ],
            },
          },
          ssr: {
            resolve: { noExternal: ["react-router"] },
            build: { rollupOptions: { input: { render: runtime("ssr.js") } } },
          },
          client: {
            optimizeDeps: {
              include: [
                "react-router",
                "react-router/internal/react-server-client",
              ],
            },
          },
        },
        ssr: {
          noExternal: [
            "@opentyped/vite-express-rsc",
            "@remix-run/node-fetch-server",
            "set-cookie-parser",
          ],
        },
      };
    },
    configResolved(resolved) {
      config = resolved;

      if (config.base !== "/" || config.build.outDir !== "dist") {
        throw new Error(
          "fullstack currently requires base '/' and build.outDir 'dist'",
        );
      }

      definitions(directory);
    },
    resolveId(source, importer) {
      if (source === "virtual:express-rsc/version") {
        return "\0express-rsc/version";
      }

      if (source === "virtual:express-rsc/routes") {
        return "\0express-rsc/routes";
      }

      if (source === "virtual:express-rsc/entry") {
        return entry;
      }

      if (importer && source.startsWith(".")) {
        const path = resolve(dirname(importer), source);

        if (path === directory) {
          return runtime("app.js");
        }
      }
    },
    load(id) {
      if (id === "\0express-rsc/version") {
        return config.command === "build"
          ? 'import manifest from "virtual:vite-rsc/assets-manifest"; export default manifest.clientVersion;'
          : 'export default "development";';
      }

      if (id === "\0express-rsc/routes") {
        return definitions(directory);
      }
    },
    configureServer(server) {
      server.watcher.add(directory);
      globals[Symbol.for("express-rsc.watch-ready")] = new Promise((resolve) =>
        server.watcher.once("ready", resolve),
      );

      const changed = (file: string) => {
        if (
          file.startsWith(directory + "/") &&
          /\/(page|layout|middleware|routes?|loading|error)\.(ts|tsx)$/.test(
            file,
          )
        ) {
          const environment = server.environments.rsc;
          const routes = environment.moduleGraph.getModuleById(
            "\0express-rsc/routes",
          );

          if (routes) {
            void environment.reloadModule(routes).catch((error: unknown) => {
              const message =
                error instanceof Error ? error.message : String(error);

              server.config.logger.error(message);
              server.ws.send({
                type: "error",
                err: {
                  message,
                  stack: error instanceof Error ? (error.stack ?? "") : "",
                },
              });
            });
          }

          return;
        }

        if (file === entry || file.includes("/server/")) {
          (
            globals[Symbol.for("express-rsc.dev")] as
              | { restart(): Promise<void> }
              | undefined
          )?.restart();
        }
      };

      server.watcher
        .on("add", changed)
        .on("unlink", changed)
        .on("change", changed);
    },
    closeBundle() {
      if (this.environment?.name !== "rsc") {
        return;
      }

      mkdirSync(resolve(root, "dist"), { recursive: true });
      writeFileSync(
        resolve(root, "dist/index.js"),
        `process.env.NODE_ENV ??= 'production';\nawait import('./ssr/index.js');\n`,
      );
    },
  };

  const versionPlugin: Plugin = {
    name: "express-rsc:version",
    enforce: "post",
    writeBundle: {
      order: "post",
      handler() {
        if (this.environment.name !== "client") {
          return;
        }

        const manifest = getPluginApi(config)?.manager.buildAssetsManifest;

        if (!manifest) {
          throw new Error(
            "Cannot generate the client version: Vite RSC asset manifest is missing",
          );
        }

        // Persist the version in the same manifest consumed by the server builds.
        // Hashing emitted references makes incompatible browser builds distinguishable.
        const version = createHash("sha256")
          .update(
            JSON.stringify(manifest, (key: string, value: unknown) =>
              key === "clientVersion" ? undefined : value,
            ),
          )
          .digest("hex");

        Object.assign(manifest, { clientVersion: version });
      },
    },
  };

  return [
    plugin,
    react(),
    rsc({
      serverHandler: false,
      entries: {
        rsc: runtime("rsc.js"),
        ssr: options.entry,
        client: runtime("browser.js"),
      },
    }),
    versionPlugin,
  ];
}

export type {
  Middlewares,
  OpenAPIOperation,
  PageLoader,
  LoaderData,
  PageProps,
  Metadata,
  ResolvedMetadata,
  MetadataFunction,
  ErrorProps,
} from "./runtime/types.js";
