import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const root = path.resolve(app, "../..");
const toolchain = path.join(app, "toolchain");
const modules = path.join(toolchain, "node_modules");
const command = process.argv[2] || "help";
const extra = process.argv.slice(3);
const env = {
  ...process.env,
  PATH: `${path.join(modules, ".bin")}${path.delimiter}${process.env.PATH || ""}`,
};

function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, { cwd, env, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function link(target, destination) {
  if (existsSync(destination) || (() => { try { return lstatSync(destination).isSymbolicLink(); } catch { return false; } })()) {
    if (realpathSync(destination) !== realpathSync(target)) {
      throw new Error(`${destination} already exists. Use a fresh checkout for the focused toolchain, or use the ordinary workspace commands.`);
    }
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  symlinkSync(target, destination, "junction");
}

function prepareLinks() {
  link(modules, path.join(root, "node_modules"));
  for (const name of ["shared-ui", "tsconfig"]) {
    link(path.join(root, "packages", name), path.join(modules, "@bb", name));
  }
}

if (command === "install") {
  const pnpm = path.join(modules, "pnpm/bin/pnpm.cjs");
  const args = ["--dir", toolchain, "install", "--frozen-lockfile", "--ignore-scripts", ...extra];
  if (existsSync(pnpm)) run(process.execPath, [pnpm, ...args]);
  else run(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "--yes", "--package=pnpm@9.15.0", "--", "pnpm", ...args]);
  prepareLinks();
  console.log("Focused dependencies installed. Electron and browser binaries were not downloaded.");
} else if (["check", "build", "dev", "preview", "desktop", "cli"].includes(command)) {
  if (!existsSync(modules)) throw new Error("Run node apps/lorca/scripts/focused.mjs install first.");
  prepareLinks();
  if (command === "check" || command === "build") {
    const tasks = command === "check" ? ["test", "typecheck", "build"] : ["build"];
    run(process.execPath, [path.join(modules, "turbo/bin/turbo"), "run", ...tasks, "--filter=@bb/lorca", ...extra]);
  } else if (command === "dev" || command === "preview") {
    run(process.execPath, [path.join(modules, "vite/bin/vite.js"), ...(command === "preview" ? ["preview"] : []), "--host", "127.0.0.1", "--port", "5178", "--strictPort", ...extra], app);
  } else if (command === "cli") {
    run(process.execPath, [path.join(app, "native/cli.cjs"), ...extra], app);
  } else {
    if (!existsSync(path.join(app, "dist/index.html"))) throw new Error("Run node apps/lorca/scripts/focused.mjs build first.");
    if (!existsSync(path.join(modules, "electron/path.txt"))) {
      run(process.execPath, [path.join(modules, "electron/install.js")], app);
    }
    run(process.execPath, [path.join(modules, "electron/cli.js"), app, ...extra], app);
  }
} else {
  console.log("Usage: node apps/lorca/scripts/focused.mjs <install|check|build|dev|preview|desktop|cli> [arguments]");
  if (command !== "help") process.exitCode = 1;
}
