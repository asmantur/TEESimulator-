// A conservative review gate: new English literals (including technical strings)
// require inspection. The baseline is deliberately updated only by a maintainer.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, tokenizer } from "acorn";

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = option("root") || fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = option("baseline") || fileURLToPath(new URL("english-baseline.json", import.meta.url));
const technicalTerms = new Set(JSON.parse(fs.readFileSync(new URL("technical-terms.json", import.meta.url), "utf8")));
const english = (value) => /[A-Za-z]{2,}/.test(value) && !/[\u3400-\u9fff]/u.test(value);
const entries = [];
function record(file, value, line) {
  if (english(value)) entries.push({ file, value, line });
}
function scanDirectory(dir) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = `${dir}/${item.name}`;
    if (item.isDirectory()) scanDirectory(file);
    else if (file.endsWith(".js")) {
      const code = fs.readFileSync(path.join(root, file), "utf8");
      parse(code, { ecmaVersion: "latest", sourceType: "module" });
      for (const token of tokenizer(code, { ecmaVersion: "latest", sourceType: "module", locations: true })) {
        if (token.type.label === "string" || token.type.label === "template") {
          record(file, token.value, token.loc.start.line);
        }
      }
    }
  }
}
scanDirectory("module/webroot/js");
for (const file of ["module/webroot/index.html", "module/customize.sh", "module/module.prop"]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const patterns = file.endsWith(".html")
    ? [/>\s*([^<>]+?)\s*</g, /(?:aria-label|title|placeholder|alt)="([^"]+)"/g]
    : file.endsWith(".sh") ? [/(?:ui_print|abort)\s+"([^"]+)"/g] : [/^description=(.+)$/gm];
  const uncommented = text.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, " "));
  for (const pattern of patterns) {
    for (const match of uncommented.matchAll(pattern)) {
      record(file, match[1].trim(), uncommented.slice(0, match.index).split("\n").length);
    }
  }
}
const key = ({ file, value }) => JSON.stringify([file, value]);
const current = [...new Map(entries.map((entry) => [key(entry), entry])).values()];
if (process.argv.includes("--write-baseline")) {
  const reviewed = current.filter(({ value }) => !technicalTerms.has(value))
    .map(({ file, value }) => ({ file, value })).sort((a, b) => key(a).localeCompare(key(b)));
  fs.writeFileSync(baselinePath, "[\n" + reviewed.map((entry) => "  " + JSON.stringify(entry)).join(",\n") + "\n]\n");
  console.log(`Recorded ${reviewed.length} English/technical literals. Review this diff before committing.`);
} else {
  const allowed = new Set(JSON.parse(fs.readFileSync(baselinePath, "utf8")).map(key));
  const fresh = current.filter((entry) => !technicalTerms.has(entry.value) && !allowed.has(key(entry)));
  if (fresh.length) {
    console.error("发现新增英文或技术字符串。请人工检查用户可见文字、补充汉化；不要自动放宽基线：");
    for (const { file, value, line } of fresh) console.error(`${file}:${line}: ${JSON.stringify(value)}`);
    process.exitCode = 1;
  } else console.log("汉化检查通过：没有未经审阅的新增英文字符串。");
}
