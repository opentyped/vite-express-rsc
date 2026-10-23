import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
/** Read dependency declarations from a package manifest. */
const read = (
  file: string,
): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} => JSON.parse(readFileSync(file, "utf8"));
/** Write a JSON file used by the isolated installation. */
const write = (file: string, value: unknown) =>
  writeFileSync(file, JSON.stringify(value, null, 2));
/** Run an npm command inside the fixture and fail if it does not finish. */
const npm = (args: string[], cwd: string) =>
  execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 90000,
  });

test(
  "packed plugin builds outside workspace; dist runs with only production dependencies",
  { timeout: 180000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "express-rsc-deployment-"));
    let child: ReturnType<typeof spawn> | undefined;

    try {
      const [packed] = JSON.parse(
        npm(
          ["pack", "--json", "--pack-destination", directory],
          join(root, "packages/vite-express-rsc"),
        ),
      );

      assert.ok(
        packed.files.some(
          (file: { path: string }) => file.path === "dist/plugin.js",
        ),
      );
      assert.ok(
        packed.files.some(
          (file: { path: string }) => file.path === "dist/plugin.d.ts",
        ),
      );
      assert.ok(
        packed.files.every(
          (file: { path: string }) => !file.path.startsWith("src/"),
        ),
      );

      const application = join(directory, "application");

      cpSync(join(root, "tests/fixture"), application, {
        recursive: true,
        filter: (file) =>
          !["dist", "node_modules"].includes(file.split("/").at(-1)!),
      });

      // Use a different directory name; nothing generated should depend on it.
      renameSync(
        join(application, "src/app"),
        join(application, "src/screens"),
      );

      const configFile = join(application, "vite.config.ts");

      writeFileSync(
        configFile,
        readFileSync(configFile, "utf8").replace("./src/app", "./src/screens"),
      );

      const entry = join(application, "src/index.ts");

      writeFileSync(
        entry,
        'import { createContext as createStartupContext } from "react";\ncreateStartupContext(null);\n' +
          readFileSync(entry, "utf8"),
      );

      const manifest = read(join(application, "package.json"));

      manifest.devDependencies["@opentyped/vite-express-rsc"] =
        `file:${join(directory, packed.filename)}`;

      const workspace = read(join(root, "package.json"));

      for (const name of [
        "typescript",
        "@types/node",
        "@types/express",
        "@types/react",
        "@types/react-dom",
      ]) {
        manifest.devDependencies[name] = workspace.devDependencies[name];
      }

      write(join(application, "package.json"), manifest);
      write(join(application, "tsconfig.json"), {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: false,
          noEmit: true,
          types: ["node", "vite/client", "@opentyped/vite-express-rsc/types"],
        },
        include: ["src", "vite.config.ts"],
      });
      npm(
        [
          "install",
          "--prefer-offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        application,
      );
      npm(["run", "build"], application);
      assert.equal(existsSync(join(application, "src/screens.d.ts")), false);
      npm(["exec", "--", "tsc", "--noEmit"], application);

      const deployed = join(directory, "deployed");

      mkdirSync(deployed);
      cpSync(join(application, "dist"), join(deployed, "dist"), {
        recursive: true,
      });
      write(join(deployed, "package.json"), {
        private: true,
        type: "module",
        dependencies: manifest.dependencies,
      });
      npm(
        [
          "install",
          "--omit=dev",
          "--prefer-offline",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        deployed,
      );
      assert.equal(existsSync(join(deployed, "src")), false);
      assert.equal(existsSync(join(deployed, "node_modules/vite")), false);
      assert.equal(
        existsSync(join(deployed, "node_modules/@opentyped/vite-express-rsc")),
        false,
      );
      child = spawn(process.execPath, ["dist/index.js"], {
        cwd: deployed,
        env: { ...process.env, PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      let errors = "";

      child.stdout!.on("data", (chunk) => (output += chunk));
      child.stderr!.on("data", (chunk) => (errors += chunk));

      const started = Date.now();

      while (!/Express listening on (\d+)/.test(output)) {
        if (child.exitCode !== null || Date.now() - started > 10000) {
          throw new Error(`Deployment failed: ${output}\n${errors}`);
        }

        await delay(50);
      }

      const port = output.match(/Express listening on (\d+)/)![1];

      assert.notEqual(port, "0");

      const base = `http://127.0.0.1:${port}`;
      const html = await (await fetch(base)).text();

      assert.match(html.replace(/<!--.*?-->/gs, ""), /Users: 27/);

      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
      ].map((match) => match[1]);

      assert.ok(assets.some((asset) => asset.endsWith(".js")));
      assert.ok(assets.some((asset) => asset.endsWith(".css")));

      for (const asset of assets) {
        assert.equal((await fetch(base + asset)).status, 200, asset);
      }

      assert.equal((await fetch(base + "/dashboard/users/42.rsc")).status, 200);
      assert.equal((await fetch(base + "/operations/42")).status, 200);

      const exited = once(child, "exit");

      child.kill("SIGTERM");

      const [code, signal] = await exited;

      assert.equal(code, null, errors);
      assert.equal(signal, "SIGTERM");
    } finally {
      if (child && child.exitCode === null) {
        child.kill("SIGKILL");
      }

      rmSync(directory, { recursive: true, force: true });
    }
  },
);
