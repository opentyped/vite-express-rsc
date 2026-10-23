import type {
  EnvironmentModuleNode,
  Plugin,
  PluginOption,
  ResolvedConfig,
  ViteDevServer,
} from "vite";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import rsc, { getPluginApi } from "@vitejs/plugin-rsc";
import { scan, rscModule, routerModule } from "./routes.js";

/** Find a built runtime file shipped with this package. */
const runtime = (file: string) =>
  fileURLToPath(new URL("./runtime/" + file, import.meta.url));

/** This package's own folder; its browser runtime is always allowed. */
const packageDirectory = fileURLToPath(new URL("..", import.meta.url)).replace(
  /\/$/,
  "",
);

/** Packages that must be bundled so deployments need no build-time dependencies. */
const bundled = [
  "@opentyped/vite-express-rsc",
  "@remix-run/node-fetch-server",
  "set-cookie-parser",
];

const virtual = {
  routes: "virtual:express/rsc/routes",
  router: "virtual:express/rsc/router",
  config: "virtual:express/rsc/config",
  version: "virtual:express/rsc/version",
  entry: "virtual:express/rsc/entry",
};

const conventionFile =
  /\/(page|layout|loading|error)\.tsx$|\/(middleware|route)\.ts$|\/routes\.tsx$/;

export interface ExpressRscOptions {
  /**
   * One filesystem tree containing pages, layouts, middleware, and endpoints.
   * It is also the browser boundary: browser code may import files inside it
   * and packages, never other project files.
   */
  directory: string;
  /**
   * Import name of the compiled handler: `express/rsc/bundle/<name>`. The
   * default bundle is also `express/rsc/bundle`.
   */
  name?: string;
}

/** Pick the single Node entry from Vite's build input. */
function entryOf(input: unknown): string {
  if (input === undefined) {
    return "./src/index.ts";
  }

  if (typeof input === "string") {
    return input;
  }

  const values = Array.isArray(input) ? input : Object.values(input as object);

  if (values.length !== 1 || typeof values[0] !== "string") {
    throw new Error(
      "expressRsc expects exactly one Node entry in build.rollupOptions.input",
    );
  }

  return values[0];
}

/** Compile Express, server components, HTML, and browser code in one Vite build. */
export function expressRsc(options: ExpressRscOptions): PluginOption[] {
  if (!options?.directory) {
    throw new Error("expressRsc requires { directory }");
  }

  const name = options.name ?? "default";
  let root: string, directory: string, entry: string;
  let config: ResolvedConfig;

  /** Generated module sources; compared on edits to skip needless reloads. */
  const generated = { routes: "", router: "" };

  /** Rescan the route tree and regenerate both route modules. */
  const generate = () => {
    const tree = scan(directory);

    generated.routes = rscModule(tree);
    generated.router = routerModule(tree, runtime("router.js"));
  };

  const plugin: Plugin = {
    name: "express/rsc:conventions",
    enforce: "pre",
    /** Configure each environment's inputs, output folder, and bundled packages. */
    config(user) {
      root = resolve(user.root || process.cwd());
      directory = resolve(root, options.directory);
      entry = resolve(root, entryOf(user.build?.rollupOptions?.input));

      const outDir = user.build?.outDir ?? "dist";
      /** Place an environment inside build.outDir unless the user chose a folder. */
      const output = (name: string) =>
        user.environments?.[name]?.build?.outDir ?? `${outDir}/${name}`;

      return {
        environments: {
          rsc: {
            resolve: { noExternal: ["react-router", ...bundled] },
            build: { outDir: output("rsc") },
          },
          ssr: {
            resolve: { noExternal: ["react-router", ...bundled] },
            build: {
              outDir: output("ssr"),
              rollupOptions: { input: { render: runtime("ssr.js") } },
            },
          },
          client: {
            build: { outDir: output("client") },
            optimizeDeps: {
              include: [
                "react-router",
                "react-router/internal/react-server-client",
              ],
            },
          },
        },
      };
    },
    /** Reject unsupported settings and validate routes before compiling anything. */
    configResolved(resolved) {
      config = resolved;

      if (config.base !== "/") {
        throw new Error(
          "expressRsc requires base '/'; mount the Express handler at a path instead",
        );
      }

      generate();
    },
    resolveId: {
      order: "pre",
      /** Resolve virtual modules and the compiled bundle import. */
      handler(source) {
        // Native handlers run in the ordinary Node graph, where server-only is allowed.
        // The browser graph keeps the upstream check.
        if (source === "server-only" && this.environment.name === "ssr") {
          return "\0express/rsc/server-only";
        }

        // One import name for request context, in every server environment.
        if (source === "express/rsc/context") {
          if (this.environment.name === "client") {
            throw new Error(
              `${source} is server code; import only its types from browser code`,
            );
          }

          return runtime("context.js");
        }

        if (source === virtual.entry) {
          return entry;
        }

        for (const [name, id] of Object.entries(virtual)) {
          if (source === id) {
            return "\0express/rsc/" + name;
          }
        }

        const bundle = /^express\/rsc\/bundle(?:\/(.+))?$/.exec(source);

        if (bundle) {
          const requested = bundle[1] ?? "default";

          if (requested !== name) {
            throw new Error(
              `Unknown bundle "${requested}" imported as ${source}; configured: ${name}`,
            );
          }

          if (this.environment.name !== "ssr") {
            throw new Error(
              `${source} is the compiled Express handler; import it only from the Node entry`,
            );
          }

          return runtime("app.js");
        }
      },
    },
    /** Generate the virtual route, router, config, and version modules. */
    load(id) {
      if (this.environment.name === "client") {
        assertBrowserSafe(id);
      }

      switch (id) {
        case "\0express/rsc/server-only":
          return "export {};";
        case "\0express/rsc/routes":
          return generated.routes;
        case "\0express/rsc/router":
          return generated.router;
        case "\0express/rsc/config": {
          const { environments } = config;
          const path = relative(
            environments.ssr.build.outDir,
            environments.client.build.outDir,
          );

          return `export const clientDirectory = ${JSON.stringify(path + "/")};`;
        }

        case "\0express/rsc/version":
          return config.command === "build"
            ? 'import manifest from "virtual:vite-rsc/assets-manifest"; export default manifest.clientVersion;'
            : 'export default "development";';
      }
    },
    /** Keep routes current during development and restart for entry changes. */
    configureServer(server) {
      server.watcher.add(directory);
      (globalThis as Record<symbol, unknown>)[
        Symbol.for("express/rsc.watch-ready")
      ] = new Promise((resolve) => server.watcher.once("ready", resolve));

      server.watcher
        .on("add", (file) => routesChanged(server, file))
        .on("unlink", (file) => routesChanged(server, file))
        .on("change", (file) => {
          routesChanged(server, file);

          if (reachesEntry(server, file)) {
            restart();
          }
        });
    },
    /** Write the production start file that loads the Node build. */
    closeBundle() {
      if (this.environment?.name !== "ssr") {
        return;
      }

      const outDir = resolve(root, config.build.outDir);
      const ssr = relative(outDir, config.environments.ssr.build.outDir);

      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, "index.js"),
        `process.env.NODE_ENV ??= "production";\nawait import(${JSON.stringify(`./${ssr}/index.js`)});\n`,
      );
    },
  };

  /**
   * Keep the browser bundle inside the route directory: project files outside
   * it, and Express modules inside it, are server code.
   */
  const assertBrowserSafe = (id: string) => {
    const file = id.split("?")[0];
    const project =
      file.startsWith(root + "/") &&
      !relative(root, file).split("/").includes("node_modules") &&
      !file.startsWith(packageDirectory + "/");

    if (project && !file.startsWith(directory + "/")) {
      throw new Error(
        `${relative(root, file)} is outside ${relative(root, directory)} and cannot be imported by browser code`,
      );
    }

    if (
      file.startsWith(directory + "/") &&
      /\/(middleware|route)\.ts$|\/routes\.tsx$/.test(file)
    ) {
      throw new Error(
        `${relative(root, file)} is an Express module and cannot be imported by browser code`,
      );
    }
  };

  /** Regenerate routes after convention edits and reload the modules that changed. */
  const routesChanged = (server: ViteDevServer, file: string) => {
    if (!file.startsWith(directory + "/") || !conventionFile.test(file)) {
      return;
    }

    const previous = { ...generated };

    try {
      generate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      server.config.logger.error(message);
      server.ws.send({ type: "error", err: { message, stack: "" } });

      return;
    }

    for (const [name, environment] of [
      ["routes", server.environments.rsc],
      ["router", server.environments.ssr],
    ] as const) {
      const module = environment.moduleGraph.getModuleById(
        "\0express/rsc/" + name,
      );

      if (module && previous[name] !== generated[name]) {
        void environment.reloadModule(module);
      }
    }
  };

  /**
   * Whether a changed file is part of the Express entry's own imports. Route
   * modules are reached only through the self-updating router, so they never
   * restart the process.
   */
  const reachesEntry = (server: ViteDevServer, file: string) => {
    const queue = [
      ...(server.environments.ssr.moduleGraph.getModulesByFile(file) ?? []),
    ];
    const seen = new Set<EnvironmentModuleNode>();

    while (queue.length) {
      const module = queue.pop()!;

      if (seen.has(module) || module.id === "\0express/rsc/router") {
        continue;
      }

      if (module.id === entry) {
        return true;
      }

      seen.add(module);
      queue.push(...module.importers);
    }

    return false;
  };

  /** Ask the development runner to restart the application process. */
  const restart = () =>
    (
      (globalThis as Record<symbol, unknown>)[Symbol.for("express/rsc.dev")] as
        | { restart(): void }
        | undefined
    )?.restart();

  const versionPlugin: Plugin = {
    name: "express/rsc:version",
    enforce: "post",
    writeBundle: {
      order: "post",
      /** Store a browser build version in the asset manifest so stale clients reload. */
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
        ssr: virtual.entry,
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

export type { RequestContext } from "./runtime/context.js";
