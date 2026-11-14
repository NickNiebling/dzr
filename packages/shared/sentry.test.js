const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const constants = require("./constants.json");
const root = path.resolve(__dirname, "../..");

// Evaluate the real entrypoints without initializing an SDK or making network calls.
function readOptions(file, env) {
  let options;
  const sdk = {
    init(value) { options = value; },
    captureConsoleIntegration() { return {}; },
    onUnhandledRejectionIntegration() { return {}; },
    captureRequestError() {},
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    process: { env }, exports, module: { exports },
    require(name) {
      if (name.startsWith("@sentry/")) return sdk;
      if (name.endsWith("constants.json")) return constants;
      if (name === "dotenv") return { config() {} };
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: file });
  if (exports.register) exports.register();
  return options;
}

for (const [file, dsnKey, environmentKey] of [
  ["instrumentation.ts", "SENTRY_DSN", "SENTRY_ENVIRONMENT"],
  ["instrumentation-client.ts", "NEXT_PUBLIC_SENTRY_DSN", "NEXT_PUBLIC_SENTRY_ENVIRONMENT"],
  ["apps/bot/instrument.js", "SENTRY_DSN", "SENTRY_ENVIRONMENT"],
]) {
  test(`${file}: production defaults, local/preview silence, overrides and disable switch`, () => {
    const production = readOptions(file, { NODE_ENV: "production" });
    assert.equal(production.dsn, constants.sentry.dsn);
    assert.equal(production.enabled, true);
    assert.equal(production.environment, "production");
    assert.equal(readOptions(file, { NODE_ENV: "development" }).enabled, false);
    assert.equal(readOptions(file, { NODE_ENV: "production", [environmentKey]: "preview" }).enabled, false);
    const override = readOptions(file, { NODE_ENV: "development", [dsnKey]: "https://public@example.invalid/1" });
    assert.equal(override.dsn, "https://public@example.invalid/1");
    assert.equal(override.enabled, true);
    assert.equal(readOptions(file, { NODE_ENV: "production", [dsnKey]: "" }).enabled, false);
  });
}

test("Vercel previews and Render production are detected from their platform variables", () => {
  const preview = readOptions("instrumentation.ts", { NODE_ENV: "production", VERCEL_ENV: "preview" });
  assert.equal(preview.environment, "preview");
  assert.equal(preview.enabled, false);
  const render = readOptions("apps/bot/instrument.js", { RENDER: "true" });
  assert.equal(render.enabled, true);
  assert.equal(render.environment, "production");
});
