import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";
import { compileLorcaCss } from "../scripts/tailwind.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const filename = path.join(root, "src/styles.css");
const config = await resolveConfig({ configFile: false, root }, "build");
const resolve = config.createResolver({
  extensions: [".css"],
  mainFields: ["style"],
  conditions: ["style"],
  preferRelative: true,
});

test("Tailwind compiles the original BB theme, source utilities, and relative font assets", async () => {
  const watched = new Set<string>();
  const css = await compileLorcaCss(await readFile(filename, "utf8"), filename, root, resolve, (file) => watched.add(file));
  assert.match(css, /--canvas:/);
  assert.match(css, /\.lorca-app/);
  assert.match(css, /\.h-9/);
  assert.match(css, /queue-boundary-row-hover/);
  assert.match(css, /@font-face/);
  assert.match(css, /inter-latin-wght-normal\.woff2/);
  assert.doesNotMatch(css, /@(?:theme|source|custom-variant|tailwind)\s/);
  assert.ok([...watched].some((file) => file.endsWith("apps/app/src/components/ui/theme.css")));
  assert.ok([...watched].some((file) => file.endsWith("packages/shared-ui/src/components/ui/button.tsx")));
});

test("Tailwind honors source exclusions and custom variants without a global fallback scan", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lorca-css-"));
  try {
    await writeFile(path.join(directory, "included.html"), '<div class="w-[317px] probe:bg-red-500"></div>');
    await writeFile(path.join(directory, "excluded.html"), '<div class="w-[319px]"></div>');
    const input = `@import "tailwindcss" source(none);\n@source "${directory}";\n@source not "${path.join(directory, "excluded.html")}";\n@custom-variant probe (&:hover);`;
    const css = await compileLorcaCss(input, filename, root, resolve);
    assert.match(css, /width: 317px/);
    assert.doesNotMatch(css, /width: 319px/);
    assert.match(css, /probe\\:bg-red-500/);
    assert.match(css, /probe\\:bg-red-500:hover/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("The focused toolchain declares every external app dependency with the same constraint", async () => {
  const app = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const toolchain = JSON.parse(await readFile(path.join(root, "toolchain/package.json"), "utf8"));
  for (const [name, constraint] of Object.entries({ ...app.dependencies, ...app.devDependencies })) {
    assert.equal(typeof constraint, "string");
    if (typeof constraint === "string" && !constraint.startsWith("workspace:")) {
      assert.equal(toolchain.dependencies[name], constraint, name);
    }
  }
  assert.equal(toolchain.dependencies.pnpm, "9.15.0");
});
