import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist");
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith(".html")) files.push(file);
  }
}
await walk(root);
// Canonical URLs include the Pages base path, so this also catches /OiAgent routing mistakes.
const errors = [];
const homepage = await readFile(path.join(root, "index.html"), "utf8");
const homeCanonical =
  homepage.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1] ||
  homepage.match(/<link\b[^>]*href="([^"]+)"[^>]*rel="canonical"/)?.[1];
if (!homeCanonical) throw new Error("Homepage has no canonical URL");
const base = new URL(homeCanonical).pathname.replace(/\/$/, "");
for (const file of files) {
  const html = await readFile(file, "utf8");
  const canonical =
    html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1] ||
    html.match(/<link\b[^>]*href="([^"]+)"[^>]*rel="canonical"/)?.[1];
  if (!canonical) {
    errors.push(`${file}: missing canonical URL`);
    continue;
  }
  const page = new URL(canonical);
  for (const [, target] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:data:|mailto:|tel:|javascript:)/.test(target)) continue;
    const url = new URL(target.replaceAll("&amp;", "&"), page);
    if (url.origin !== page.origin) continue;
    if (base && url.pathname !== base && !url.pathname.startsWith(base + "/")) {
      errors.push(
        `${path.relative(root, file)}: link escapes Pages base: ${target}`,
      );
      continue;
    }
    const local = decodeURIComponent(url.pathname.slice(base.length)).replace(
      /^\//,
      "",
    );
    const resolved =
      url.pathname === page.pathname
        ? file
        : path.join(root, local || "index.html");
    const candidates = [resolved, path.join(resolved, "index.html")];
    let exists = false;
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) {
          exists = true;
          break;
        }
      } catch {
        /* Try directory index. */
      }
    }
    if (!exists) errors.push(`${path.relative(root, file)}: missing ${target}`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Checked local links and assets in ${files.length} static pages.`);
