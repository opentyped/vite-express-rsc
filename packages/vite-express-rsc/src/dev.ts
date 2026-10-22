#!/usr/bin/env node
import { createServer, isRunnableDevEnvironment } from "vite";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { createServer as createHttpServer } from "node:http";

const key = Symbol.for("express-rsc.dev");
let listener: Server | undefined;
const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
const sockets = new Set<Socket>();
const upgrades = createHttpServer();
const vite = await createServer({
  server: {
    middlewareMode: true,
    watch: { usePolling: true, interval: 100 },
    hmr: { server: upgrades, clientPort: Number(process.env.PORT ?? 3000) },
  },
  appType: "custom",
});
const nodeEnvironment = () => {
  const environment = vite.environments.ssr;

  if (!isRunnableDevEnvironment(environment)) {
    throw new Error("The Node entry environment requires Vite's module runner");
  }

  return environment;
};

const bridge = {
  middleware: vite.middlewares,
  restart: () => vite.restart(),
};

globals[key] = bridge;

const start = async () => {
  await globals[Symbol.for("express-rsc.watch-ready")];

  const entry = await nodeEnvironment().runner.import<{ listener?: Server }>(
    "virtual:express-rsc/entry",
  );

  listener = entry.listener;

  if (!listener?.close) {
    throw new Error(
      "The Node entry must export its HTTP listener as `listener` for development restarts",
    );
  }

  listener.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  listener.on("upgrade", (...args) => upgrades.emit("upgrade", ...args));
};

let restarting: Promise<void> | undefined;
let queued = false;
const installRestart = () => {
  const restart = vite.restart.bind(vite);

  vite.restart = (...args) => {
    if (restarting) {
      queued = true;

      return restarting;
    }

    restarting = (async () => {
      do {
        queued = false;

        const previousEnvironments = vite.environments;

        // Vite validates the new configuration before replacing its environments.
        // A failed compilation leaves the existing server available for repair.
        await restart(...args);

        if (vite.environments === previousEnvironments) {
          continue;
        }

        installRestart();
        bridge.middleware = vite.middlewares;

        if (listener?.listening) {
          const active = listener;
          const closed = new Promise<void>((resolve, reject) =>
            active.close((error) => (error ? reject(error) : resolve())),
          );

          for (const socket of sockets) {
            socket.destroy();
          }

          await closed;
        }

        await start();
      } while (queued);

      vite.ws.send({ type: "full-reload" });
    })()
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error);

        vite.config.logger.error(message);
      })
      .finally(() => {
        restarting = undefined;
      });

    return restarting;
  };
};

installRestart();
await start();
