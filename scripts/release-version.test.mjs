import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { releaseVersion, syncReleaseVersion } from "./release-version.mjs";
test("validates release tags without accepting shell fragments or non-semver versions", () => {
  assert.equal(releaseVersion("v1.2.3-beta.1"), "1.2.3-beta.1");
  assert.equal(releaseVersion("1.2.3"), "1.2.3");
  for (const tag of [
    "v01.2.3",
    "v1.2",
    "v1.2.3-01",
    "v1.2.3;echo bad",
    "v1.2.3+local",
    "",
  ])
    assert.throws(() => releaseVersion(tag));
});
test("updates the app, npm and Cargo versions together only in the supplied checkout", () => {
  const root = mkdtempSync(resolve(tmpdir(), "oiagent-release-test-"));
  const files = [
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ];
  try {
    mkdirSync(resolve(root, "src-tauri"));
    for (const name of files)
      copyFileSync(new URL("../" + name, import.meta.url), resolve(root, name));
    assert.equal(syncReleaseVersion("v1.2.3-beta.1", root), "1.2.3-beta.1");
    for (const name of files.slice(0, 3))
      assert.equal(
        JSON.parse(readFileSync(resolve(root, name), "utf8")).version,
        "1.2.3-beta.1",
      );
    const lock = JSON.parse(
      readFileSync(resolve(root, "package-lock.json"), "utf8"),
    );
    assert.equal(lock.packages[""].version, "1.2.3-beta.1");
    for (const name of files.slice(3))
      assert.match(
        readFileSync(resolve(root, name), "utf8"),
        /name = "oiagent"\nversion = "1.2.3-beta.1"/,
      );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
