import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("new English is blocked; Chinese and previously reviewed protocol values pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "teesim-l10n-"));
  const checker = fileURLToPath(new URL("check.mjs", import.meta.url));
  const baseline = path.join(root, "baseline.json");
  const run = (...args) => spawnSync(process.execPath, [checker, `--root=${root}`, `--baseline=${baseline}`, ...args], { encoding: "utf8" });
  try {
    fs.mkdirSync(path.join(root, "module/webroot/js"), { recursive: true });
    const ui = path.join(root, "module/webroot/js/app.js");
    fs.writeFileSync(ui, 'export const mode = "patch"; // English comments are not UI\n');
    fs.writeFileSync(path.join(root, "module/webroot/index.html"), '<html lang="zh-CN"><button>保存</button></html>');
    fs.writeFileSync(path.join(root, "module/customize.sh"), 'ui_print "安装中"\n');
    fs.writeFileSync(path.join(root, "module/module.prop"), 'description=中文版\n');
    assert.equal(run("--write-baseline").status, 0);
    assert.equal(run().status, 0);
    fs.appendFileSync(ui, 'const securityLevel = "TrustedEnvironment";\n');
    assert.equal(run().status, 0, "Approved technical terms need not be translated");
    fs.appendFileSync(ui, 'const button = "Save new settings";\n');
    assert.equal(run().status, 1);
    assert.match(run().stderr, /Save new settings/);
    fs.writeFileSync(ui, 'export const mode = "patch"; const button = "保存新设置";\n');
    assert.equal(run().status, 0);
    fs.appendFileSync(ui, 'const msg = `New update: ${mode}`;\n');
    assert.equal(run().status, 1);
    fs.writeFileSync(ui, 'export const mode = "patch";\n');
    for (const [file, content] of [
      ["module/webroot/index.html", '<button aria-label="New action">New screen</button>'],
      ["module/customize.sh", 'abort "Unsupported device"\n'],
      ["module/module.prop", 'description=New English description\n'],
    ]) {
      const original = fs.readFileSync(path.join(root, file));
      fs.writeFileSync(path.join(root, file), content);
      assert.equal(run().status, 1, file);
      fs.writeFileSync(path.join(root, file), original);
    }
    fs.writeFileSync(ui, 'export const broken = ;');
    assert.notEqual(run().status, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
