#!/usr/bin/env node
/** Reject the /eu path segment in Zwift event links; leave other URL content alone. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const eventPrefix = /(?:https?:)?\/\/(?:www\.)?zwift\.com\/eu\/events\/(?:[^\s"'`<>/?#]+\/)*view\//g;
const files = new Set(
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
);
let failures = 0;

for (const file of files) {
  let contents;
  try {
    contents = fs.readFileSync(path.join(root, file));
  } catch (error) {
    if (error.code === "ENOENT") continue; // A tracked file deleted in the working tree.
    throw error;
  }
  if (contents.includes(0)) continue;
  for (const [index, line] of contents.toString("utf8").split(/\r?\n/).entries()) {
    // Legacy URL inputs may be retained to test parsers, with an explicit line annotation.
    if (/\.test\.[cm]?[jt]sx?$/.test(file) && line.includes("zwift-link-check: allow-input")) continue;
    for (const match of line.matchAll(eventPrefix)) {
      console.error(`${file}:${index + 1}: remove only /eu from Zwift event URL: ${match[0]}`);
      failures += 1;
    }
  }
}

if (failures) {
  console.error("Remove only /eu from these event links. Preserve every other part of each URL.");
  process.exitCode = 1;
} else {
  console.log("No Zwift event links contain the /eu path segment.");
}
