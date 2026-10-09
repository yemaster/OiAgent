import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseVersion(tag) {
  const version = tag.replace(/^v/, "");
  const number = "(0|[1-9][0-9]*)";
  const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
  if (
    !new RegExp(
      `^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`,
    ).test(version)
  )
    throw new Error(
      "版本 tag 格式应为 v1.2.3 或 v1.2.3-beta.1（也支持不带 v）",
    );
  return version;
}

export function syncReleaseVersion(tag, root) {
  const version = releaseVersion(tag);
  for (const name of [
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
  ]) {
    const path = resolve(root, name);
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.version = version;
    if (value.packages?.[""]) value.packages[""].version = version;
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  }
  for (const name of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    const path = resolve(root, name);
    const text = readFileSync(path, "utf8");
    const pattern =
      /(\[\[?package\]?\]\s*\nname = "oiagent"\s*\nversion = ")[^"]+("\s*\n)/;
    if (!pattern.test(text))
      throw new Error(`找不到 ${name} 中的 OiAgent 版本`);
    writeFileSync(
      path,
      text.replace(pattern, (_, before, after) => before + version + after),
    );
  }
  return version;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    syncReleaseVersion(
      process.env.RELEASE_TAG || process.argv[2] || "",
      fileURLToPath(new URL("..", import.meta.url)),
    ),
  );
}
