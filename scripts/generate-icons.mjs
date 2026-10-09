import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
const generate = (...args) =>
  execFileSync(process.execPath, [cli, "icon", ...args], {
    cwd: root,
    stdio: "inherit",
  });

generate("public/brand/oiagent-app.svg", "--output", "src-tauri/icons");
generate(
  "public/brand/oiagent-mark.svg",
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

// Keep downloadable PNG sources in sync with the editable vectors.
const temp = mkdtempSync(resolve(tmpdir(), "oiagent-icons-"));
try {
  for (const name of ["oiagent-app", "oiagent-mark"]) {
    generate(`public/brand/${name}.svg`, "--output", temp, "--png", "1024");
    copyFileSync(
      resolve(temp, "1024x1024.png"),
      resolve(root, `public/brand/${name}.png`),
    );
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
