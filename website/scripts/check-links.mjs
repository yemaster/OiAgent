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
// Verify the public deployment root as well as local files: a valid repository prefix can still break a custom domain.
const errors = [];
const htmlCache = new Map();
async function readHtml(file) {
  if (!htmlCache.has(file)) htmlCache.set(file, await readFile(file, "utf8"));
  return htmlCache.get(file);
}
const homepage = await readFile(path.join(root, "index.html"), "utf8");
const homeCanonical =
  homepage.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1] ||
  homepage.match(/<link\b[^>]*href="([^"]+)"[^>]*rel="canonical"/)?.[1];
if (!homeCanonical) throw new Error("Homepage has no canonical URL");
const homeUrl = new URL(homeCanonical);
const expectedSite = new URL(
  process.env.PAGES_SITE || "https://oiagent.yemaster.cn",
);
const expectedBase = (process.env.PAGES_BASE || "/").replace(/\/$/, "");
if (
  homeUrl.origin !== expectedSite.origin ||
  homeUrl.pathname.replace(/\/$/, "") !== expectedBase
) {
  throw new Error(
    `Wrong deployment URL: ${homeCanonical}; expected ${expectedSite.origin}${expectedBase}/`,
  );
}
const base = homeUrl.pathname.replace(/\/$/, "");
for (const file of files) {
  const html = await readHtml(file);
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
    let destination;
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) {
          exists = true;
          destination = candidate;
          break;
        }
      } catch {
        /* Try directory index. */
      }
    }
    if (!exists) errors.push(`${path.relative(root, file)}: missing ${target}`);
    else if (url.hash && destination.endsWith(".html")) {
      const fragment = decodeURIComponent(url.hash.slice(1));
      const ids = new Set(
        [...(await readHtml(destination)).matchAll(/\bid="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      );
      if (!ids.has(fragment)) {
        errors.push(`${path.relative(root, file)}: missing anchor ${target}`);
      }
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Checked local links and assets in ${files.length} static pages.`);
