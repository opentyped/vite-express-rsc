#!/usr/bin/env node
import { fork, type ChildProcess } from "node:child_process";
import { subscribe } from "node:diagnostics_channel";
import { createServer as createHttpServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer, isRunnableDevEnvironment } from "vite";

const worker = "EXPRESS_RSC_DEV_WORKER";

if (process.env[worker]) {
  await runWorker();
} else {
  supervise();
}

/**
 * Keep one worker process running the application. A restart replaces the
 * whole process, so the application's listener, timers, and connections close
 * the same way they would in production.
 */
function supervise() {
  let child: ChildProcess | undefined;
  let restarting = false;
  let stopping = false;

  /** Start a worker and replace it when it asks for a restart. */
  const start = () => {
    child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), {
      env: { ...process.env, [worker]: "1" },
    });
    child.on("message", (message) => {
      if (message === "restart" && !restarting) {
        restarting = true;
        child?.kill("SIGTERM");
      }
    });
    child.on("exit", (code, signal) => {
      if (restarting && !stopping) {
        restarting = false;
        start();
      } else {
        process.exit(code ?? (signal ? 1 : 0));
      }
    });
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      stopping = true;
      child?.kill(signal);
    });
  }

  start();
}

/** Run Vite in middleware mode and import the application's Node entry. */
async function runWorker() {
  // Vite's HMR socket shares the application's port: upgrades that reach the
  // application's own server are forwarded to this detached socket server.
  const upgrades = createHttpServer();
  const vite = await createServer({
    server: { middlewareMode: true, ws: { server: upgrades } },
    appType: "custom",
  });
  const restart = () => {
    process.send?.("restart");
  };

  const forwarded = new WeakSet<Server>();

  // Find the application's server from its first request, without requiring an export.
  subscribe("http.server.request.start", (message) => {
    const { server } = message as { server: Server };

    if (server !== upgrades && !forwarded.has(server)) {
      forwarded.add(server);
      server.on("upgrade", (...args) => upgrades.emit("upgrade", ...args));
    }
  });

  (globalThis as Record<symbol, unknown>)[Symbol.for("express/rsc.dev")] = {
    middleware: vite.middlewares,
    restart,
  };
  // Vite restarts itself for config edits; the application must restart with it.
  vite.restart = async () => restart();

  await (globalThis as Record<symbol, unknown>)[
    Symbol.for("express/rsc.watch-ready")
  ];

  const environment = vite.environments.ssr;

  if (!isRunnableDevEnvironment(environment)) {
    throw new Error("The Node entry environment requires Vite's module runner");
  }

  try {
    await environment.runner.import("virtual:express/rsc/entry");
  } catch (error) {
    vite.config.logger.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    // Retry once the broken file is saved again.
    vite.watcher.once("change", restart);
  }
}
