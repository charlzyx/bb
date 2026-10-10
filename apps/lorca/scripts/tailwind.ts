import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile } from "tailwindcss";
import { Scanner } from "@tailwindcss/oxide";
import type { Plugin, ResolveFn } from "vite";

export async function compileLorcaCss(
  input: string,
  filename: string,
  root: string,
  resolve: ResolveFn,
  watch: (filename: string) => void = () => {},
): Promise<string> {
  const base = path.dirname(filename);
  const compiler = await compile(input, {
    base,
    from: filename,
    async loadStylesheet(id, importer) {
      const filename = await resolve(id, path.join(importer, "__lorca_css__.css"));
      if (!filename) throw new Error(`Cannot resolve stylesheet ${id} from ${importer}`);
      watch(filename);
      const content = (await readFile(filename, "utf8")).replace(
        /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
        (original: string, quote: string, url: string) => {
          if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return original;
          const asset = path.resolve(path.dirname(filename), url);
          const relative = path.relative(base, asset).split(path.sep).join("/");
          return `url(${quote}${relative.startsWith(".") ? relative : `./${relative}`}${quote})`;
        },
      );
      return { path: filename, base: path.dirname(filename), content };
    },
  });
  const sources = [...compiler.sources];
  if (compiler.root !== "none") {
    sources.push({
      base: compiler.root?.base ?? root,
      pattern: compiler.root?.pattern ?? "**/*",
      negated: false,
    });
  }
  const scanner = new Scanner({ sources });
  const candidates = scanner.scan();
  for (const filename of scanner.files) watch(filename);
  return compiler.build(candidates);
}

export function lorcaTailwind(): Plugin {
  let root = process.cwd();
  let resolve: ResolveFn = async () => undefined;
  return {
    name: "lorca-tailwind",
    enforce: "pre",
    configResolved(config) {
      root = config.root;
      resolve = config.createResolver({
        extensions: [".css"],
        mainFields: ["style"],
        conditions: ["style"],
        preferRelative: true,
      });
    },
    async transform(input, id) {
      const filename = id.split("?")[0];
      if (filename !== path.join(root, "src/styles.css")) return;
      return {
        code: await compileLorcaCss(input, filename, root, resolve, (file) => this.addWatchFile(file)),
        map: null,
      };
    },
  };
}
