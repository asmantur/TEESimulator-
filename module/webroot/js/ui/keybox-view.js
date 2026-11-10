// The Keyboxes panel. The resting screen is the list of *.xml keyboxes on disk, each a
// row whose name is the inspect trigger plus Rename and Delete; Import is the panel-head
// primary and opens a bottom sheet (file picker + name field + Import) built by
// renderKeyboxImport. Inspecting opens a drill-in that pretty-prints the parsed
// certificate chains (renderKeyboxInspect). Pure
// DOM through el(); it renders from controller state and emits intents through `actions`.
// It never imports data/* or bridge/*. All text is textContent via el's `text`, never
// innerHTML.
//
// renderKeyboxes(mount, state, actions)
//   state   = { files }
//   actions = { onImport(), inspect(name), rename(name), delete(name) }
//
// renderKeyboxImport(state, actions) -> HTMLElement   (content for the import sheet)
//   state   = { importName, importContent, error }
//   actions = { pickFile(file), setImportName(str), import(), close() }
//
// renderKeyboxInspect(state, actions) -> HTMLElement  (content for the inspect drill-in)
//   state   = { name, data }   the /keybox/inspect response to pretty-print
//   actions = { close() }

import { el, clear } from "./dom.js";

export function renderKeyboxes(mount, state, actions) {
  clear(mount);
  const { files = [] } = state;

  mount.appendChild(el("div", { class: "panel-head" }, [
    el("h1", { class: "panel-title", text: "密钥箱" }),
    el("button", { class: "btn primary", text: "导入", onclick: () => actions.onImport() }),
  ]));

  if (!files.length) {
    mount.appendChild(el("div", { class: "card empty" },
      [el("p", { class: "muted", text: "暂无密钥箱。请导入用于签署证明的 *.xml 密钥箱。" })]));
    return;
  }

  const list = el("ul", { class: "kb-list card" });
  for (const name of files) {
    list.appendChild(el("li", { class: "kb-row" }, [
      // The name is the inspect trigger: a small keybox badge + the filename, keyboard-reachable,
      // that wraps instead of shoving the Rename/Delete buttons off the row.
      el("button", {
        class: "kb-name mono", type: "button",
        title: "查看 " + name, onclick: () => actions.inspect(name),
      }, [
        el("span", { class: "kb-icon", "aria-hidden": "true" }),
        el("span", { class: "kb-file", text: name }),
      ]),
      el("div", { class: "keybtns" }, [
        el("button", { class: "btn small ghost", text: "重命名", onclick: () => actions.rename(name) }),
        el("button", { class: "btn small danger ghost", text: "删除", onclick: () => actions.delete(name) }),
      ]),
    ]));
  }
  mount.appendChild(list);
}

export function renderKeyboxImport(state, actions) {
  const { importName = "", importContent = "", error = null } = state;

  // No `accept` filter: Android's document picker greys out any file whose provider
  // MIME isn't an exact match (a keybox reports text/xml or octet-stream, not the
  // application/xml the filter asks for), so it looked like "no file is selectable".
  // We validate the content after reading instead, so any file can be chosen.
  const fileInput = el("input", {
    class: "input", type: "file",
    onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) actions.pickFile(f); },
  });
  // Bare keystrokes only sync the controller's field; they never re-render, so the
  // caret is never yanked mid-type. A discrete pickFile/import redraws.
  const nameInput = el("input", {
    class: "input", type: "text", value: importName, placeholder: "keybox.xml",
    autocapitalize: "off", autocorrect: "off", spellcheck: "false",
    oninput: (e) => actions.setImportName(e.target.value),
  });

  return el("div", {}, [
    el("div", { class: "sheet-head" }, [
      el("h2", { text: "导入密钥箱" }),
      el("button", { class: "iconbtn", type: "button", "aria-label": "关闭", onclick: () => actions.close() }, [
        el("span", { class: "x-mark", "aria-hidden": "true" }),
      ]),
    ]),
    error ? el("div", { class: "banner error" }, [el("div", { text: error })]) : null,
    el("div", { class: "field" }, [el("span", { class: "field-label", text: "密钥箱文件" }), fileInput]),
    el("div", { class: "field" }, [el("span", { class: "field-label", text: "保存为" }), nameInput]),
    el("button", { class: "btn primary block sheet-submit", text: "导入", disabled: !importContent, onclick: () => actions.import() }),
    el("p", { class: "field-help", text: "文件将复制到 /data/adb/teesim，使用上方输入的名称作为文件名。" }),
  ]);
}

// ---- inspect drill-in ---------------------------------------------------
// The body is filled by fillKeyboxInspect so the controller can refill the SAME .drill-body element
// on pull-to-refresh — keeping the scroll container (and its pull-to-refresh binding) in place.
export function fillKeyboxInspect(body, state) {
  const { name = "", data = null } = state;
  clear(body);
  body.appendChild(el("div", { class: "keyalias" }, [el("span", { class: "mono", text: name })]));

  if (!data || data.ok === false) {
    body.appendChild(el("div", { class: "banner error" }, [
      el("div", { text: (data && data.error) || "无法查看此密钥箱。" }),
    ]));
    return;
  }
  if (data.deviceId) body.appendChild(el("div", { class: "muted small", text: "设备 ID：" + data.deviceId }));
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (!keys.length) body.appendChild(el("p", { class: "muted", text: "此密钥箱中未找到 <Key> 节点。" }));
  for (const k of keys) body.appendChild(keyBlock(k));
}

export function renderKeyboxInspect(state, actions) {
  const body = el("div", { class: "drill-body" });
  fillKeyboxInspect(body, state);

  return el("div", {}, [
    el("div", { class: "drill-head" }, [
      el("button", { class: "iconbtn", type: "button", "aria-label": "返回密钥箱", onclick: () => actions.close() }, [
        el("span", { class: "chevron-left", "aria-hidden": "true" }),
      ]),
      el("h1", { class: "drill-title", text: "密钥箱", tabindex: "-1" }),
    ]),
    body,
  ]);
}

function keyBlock(k) {
  const linkage = k.linkage || "";
  const linkChip =
    linkage === "ok" ? el("span", { class: "chip good", text: "证书链正常" })
    : linkage === "broken" ? el("span", { class: "chip warn", text: "证书链断裂" })
    : linkage === "single" ? el("span", { class: "chip", text: "单张证书" })
    : null;
  const head = el("div", { class: "kbi-head" }, [
    el("span", { class: "chip mono", text: (k.algorithm || "?").toUpperCase() }),
    el("span", { class: "chip", text: (k.chainLength || 0) + (k.chainLength === 1 ? " 张证书" : " 张证书") }),
    linkChip,
    k.privateKeyPresent
      ? el("span", { class: "chip good", text: "含私钥" })
      : el("span", { class: "chip warn", text: "无私钥" }),
  ]);
  const certs = Array.isArray(k.certs) ? k.certs : [];
  return el("div", { class: "card kbi-key" }, [verdictBanner(k), head, ...certs.map(certBlock)]);
}

// The headline verdict for a chain: is this a genuine, live keybox that would pass hardware
// attestation, or a revoked / software / broken one? Built from the daemon's chain-level fields.
function verdictOf(k) {
  const unchecked = k.revocationChecked === false;
  if (k.revoked) {
    return { tier: "bad", icon: "✕", title: "已被 Google 吊销",
      sub: "此证书链中的证书已列入 Google 吊销列表，其签署的证明会被 Play Integrity 拒绝。" };
  }
  if (k.chainVerified === false) {
    return { tier: "bad", icon: "✕", title: "证书链验证失败",
      sub: "证书链中存在无效签名，无法用作有效的证明证书链。" };
  }
  const revNote = unchecked ? " · 无法获取吊销列表" : " · 未吊销";
  switch (k.rootAuthority) {
    case "google":
      return { tier: "good", icon: "✓", title: "Google 签署",
        sub: "证书链以 Google 硬件证明密钥为根" + revNote + "." };
    case "knox":
      return { tier: "good", icon: "✓", title: "三星 Knox 根证书",
        sub: "证书链以三星 Knox 证明密钥为根" + revNote + "." };
    case "aosp":
      return { tier: "warn", icon: "!", title: "AOSP 软件根证书",
        sub: "以 AOSP 软件测试密钥为根，不属于硬件支持的密钥箱，无法通过硬件证明验证。" };
    default:
      return { tier: "warn", icon: "?", title: "未知根证书",
        sub: "证书链的根不属于已识别的证明机构" + (unchecked ? " · 无法获取吊销列表" : "") + "." };
  }
}

function verdictBanner(k) {
  const v = verdictOf(k);
  return el("div", { class: "kbi-verdict kbi-verdict--" + v.tier }, [
    el("span", { class: "kbi-verdict-icon", "aria-hidden": "true", text: v.icon }),
    el("div", { class: "kbi-verdict-text" }, [
      el("div", { class: "kbi-verdict-title", text: v.title }),
      el("div", { class: "kbi-verdict-sub", text: v.sub }),
    ]),
  ]);
}

function certBlock(c) {
  if (c.error) {
    return el("div", { class: "kbi-cert" }, [el("div", { class: "err", text: "证书 " + c.index + ": " + c.error })]);
  }
  const authTier = c.rootAuthority === "google" || c.rootAuthority === "knox" ? "good" : "warn";
  const badges = el("div", { class: "chips" }, [
    el("span", { class: "chip", text: roleOf(c) }),
    el("span", { class: "chip mono", text: (c.keyAlgorithm || "?") + (c.keySize ? " " + c.keySize : "") }),
    c.rootAuthority ? el("span", { class: "chip " + authTier, text: authorityLabel(c.rootAuthority) }) : null,
    c.revoked ? el("span", { class: "chip danger", text: "已吊销" }) : null,
    c.signatureValid === false ? el("span", { class: "chip warn", text: "签名无效" }) : null,
    c.expired ? el("span", { class: "chip warn", text: "已过期" }) : null,
    c.notYetValid ? el("span", { class: "chip warn", text: "尚未生效" }) : null,
  ]);
  return el("div", { class: "kbi-cert" }, [
    badges,
    kv("主体", c.subject),
    kv("颁发者", c.issuer),
    kv("序列号", c.serial),
    c.revoked ? kv("吊销状态", (c.revocationStatus || "REVOKED") + (c.revocationReason ? " · " + c.revocationReason : "")) : null,
    kv("有效期", fmtDate(c.notBefore) + "  →  " + fmtDate(c.notAfter)),
    kv("签名算法", c.sigAlg),
  ]);
}

function authorityLabel(a) {
  switch (a) {
    case "google": return "Google 根证书";
    case "aosp": return "AOSP 根证书";
    case "knox": return "Knox 根证书";
    case "none": return "无根证书";
    default: return "未知根证书";
  }
}

function roleOf(c) {
  if (c.index === 0) return "叶证书";
  if (c.selfSigned) return "根证书";
  return c.isCa ? "中间证书" : "证书 " + c.index;
}

function kv(label, value) {
  return el("div", { class: "kv kv-stack" }, [
    el("span", { class: "kv-label", text: label }),
    el("span", { class: "mono kv-hex", text: value == null || value === "" ? "—" : String(value) }),
  ]);
}

function fmtDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try { return new Date(n).toISOString().slice(0, 10); } catch { return String(ms); }
}
