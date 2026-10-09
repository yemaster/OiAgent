import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
const generate = (...args) =>
  execFileSync(process.execPath, [cli, "icon", ...args], {
    cwd: root,
    stdio: "inherit",
  });

generate("public/brand/oiagent-app.png", "--output", "src-tauri/icons");
generate(
  "public/brand/oiagent-mark.png",
  "--output",
  "public/brand/mark",
  "--png",
  "256",
);
copyFileSync(
  resolve(root, "src-tauri/icons/32x32.png"),
  resolve(root, "public/favicon.png"),
);
copyFileSync(
  resolve(root, "src-tauri/icons/icon.ico"),
  resolve(root, "public/favicon.ico"),
);
