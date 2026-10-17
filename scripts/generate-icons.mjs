import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

// The documentation site uses the same brand assets as the desktop app.
for (const [source, target] of [
  ["public/brand/oiagent-app.svg", "website/public/oiagent.svg"],
  ["public/favicon.png", "website/public/favicon.png"],
])
  copyFileSync(resolve(root, source), resolve(root, target));

// Keep downloadable PNG sources in sync with the editable vectors.
const temp = mkdtempSync(resolve(tmpdir(), "oiagent-icons-"));
try {
  // A transparent mark for the tray; macOS uses its alpha as a system template.
  const traySource = resolve(temp, "tray.svg");
  writeFileSync(
    traySource,
    readFileSync(
      resolve(root, "public/brand/oiagent-mark.svg"),
      "utf8",
    ).replaceAll('"black"', '"#737373"'),
  );
  generate(traySource, "--output", "src-tauri/icons/tray", "--png", "32");
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
