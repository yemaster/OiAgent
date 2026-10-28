import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, join } from "node:path";
import { gzipSync } from "node:zlib";

// Follow static imports only. Lazy pages and editor workers are shipped, but
// should not be counted as JavaScript loaded by the application shell.
const root = resolve(import.meta.dirname, "../dist");
const manifest = JSON.parse(
  await readFile(join(root, ".vite/manifest.json"), "utf8"),
);
const visited = new Set();
function visit(key) {
  if (visited.has(key)) return;
  visited.add(key);
  for (const dependency of manifest[key].imports || []) visit(dependency);
}
for (const [key, entry] of Object.entries(manifest)) {
  if (entry.isEntry) visit(key);
}
const shell = new Set([...visited].map((key) => manifest[key].file));
let shellBytes = 0;
let shellGzip = 0;
for (const file of shell) {
  const contents = await readFile(join(root, file));
  shellBytes += contents.length;
  shellGzip += gzipSync(contents).length;
}
async function filesIn(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".vite") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile())
      files.push({
        file: relative(root, path),
        bytes: (await stat(path)).size,
      });
  }
  return files;
}
const files = await filesIn(root);
const kb = (size) => `${(size / 1000).toFixed(1)} kB`;
console.log(
  `Frontend assets: ${kb(files.reduce((total, file) => total + file.bytes, 0))}`,
);
console.log(`Shell JavaScript: ${kb(shellBytes)} (gzip ${kb(shellGzip)})`);
console.log("Largest assets (including lazy modules):");
for (const { file, bytes } of files
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 8)) {
  console.log(`  ${kb(bytes).padStart(12)}  ${file}`);
}
