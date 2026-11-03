#!/usr/bin/env node
/** Reject event links whose path prevents Zwift Companion from opening them. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const canonical = "https://www.zwift.com/events/view/";
const eventPrefix = /(?:https?:)?\/\/(?:www\.)?zwift\.com\/(?:[^\s"'`<>/?#]+\/)*events\/(?:[^\s"'`<>/?#]+\/)*view\//gi;
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
      if (match[0] === canonical) continue;
      console.error(`${file}:${index + 1}: invalid Zwift event URL prefix: ${match[0]}`);
      failures += 1;
    }
  }
}

if (failures) {
  console.error(`Use ${canonical}<event-id> so Zwift Companion can open event links.`);
  process.exitCode = 1;
} else {
  console.log("All Zwift event links use the Companion-compatible URL prefix.");
}
