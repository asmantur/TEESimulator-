// The System screen: daemon health, harvest summary, and the canary updater — the
// three "is the system healthy and current?" concerns on one read-mostly screen.
// Pure presentation: it renders from the state the controller hands it and emits
// every intent through `actions`. It never imports data/* or bridge/*; the update
// probe/install all happen in the controller through the daemon seam.
//
// renderSystem(mount, state, actions)
//   state = {
//     status,       // { daemonRunning, reachable, hookActive, hook, api, harvest, error? } | null
//     update,       // { installedVersion, currentCode, latest:{code,tag,name,notes,htmlUrl,commit,assets}|null, updateAvailable } | null
//     probed,       // true once the canary probe has resolved (else "checking")
//     variant,      // "release" | "debug" — the selected asset to flash
//     installing,   // true while a flash is in flight (Install disabled + progress)
//     installError, // string | null — surfaced as a .banner.error
//     notesOpen,    // "What's new" disclosure state
//   }
//   actions = { onInstall(), onSelectVariant(v), onToggleNotes() }

import { el, clear, disclosure } from "./dom.js";
import { renderMarkdown } from "./markdown.js";

export function renderSystem(mount, state, actions) {
  clear(mount);
  const { status = null, update = null, probed = false,
          variant = "release", installing = false, installError = null, notesOpen = false } = state;

  mount.appendChild(el("div", { class: "panel-head" }, [el("h1", { class: "panel-title", text: "系统" })]));

  mount.appendChild(tag(healthCard(status), "health"));
  mount.appendChild(tag(harvestCard(status, actions), "harvest"));
  mount.appendChild(tag(updateCard({ update, probed, variant, installing, installError, notesOpen }, actions), "update"));
}

// Patch ONLY the health + harvest cards from a fresh status snapshot, leaving the
// interactive Update card (and any open disclosure / variant choice / focus) exactly
// as it is. The 5 s health poll calls this instead of renderSystem so it never tears
// down the updater. The harvest card is skipped while one of its override inputs is
// focused, so a re-render never wipes a value mid-edit. Returns false when the screen
// hasn't been fully rendered yet (e.g. probed on boot before it's shown), so the caller
// can fall back to a full render.
export function refreshHealth(mount, status, actions) {
  const oldHealth = mount.querySelector('[data-card="health"]');
  const oldHarvest = mount.querySelector('[data-card="harvest"]');
  if (!oldHealth || !oldHarvest) return false;
  oldHealth.replaceWith(tag(healthCard(status), "health"));
  const active = document.activeElement;
  const editing = active && active.tagName === "INPUT" && oldHarvest.contains(active);
  if (!editing) oldHarvest.replaceWith(tag(harvestCard(status, actions), "harvest"));
  return true;
}

// Stamp a card's slot marker so the health-only patch path can find and swap it.
function tag(card, name) {
  card.setAttribute("data-card", name);
  return card;
}

// --- daemon health -------------------------------------------------------
function healthCard(status) {
  if (!status) {
    return el("div", { class: "card" }, [el("h2", { text: "守护进程状态" }), el("p", { class: "muted", text: "正在读取状态…" })]);
  }
  const dot = (cls) => el("span", { class: "dot " + cls });
  // Interceptor: attached is ok; the daemon up but nothing attached yet is a
  // degraded (amber) state, not a hard failure.
  const interceptorDot = status.hookActive ? "ok" : (status.daemonRunning ? "warn" : "off");
  const interceptorText = status.hookActive ? "已激活" : (status.daemonRunning ? "未附加" : "未激活");

  const card = el("div", { class: "card" }, [
    el("h2", { text: "守护进程状态" }),
    row("守护进程", el("span", { class: "status" }, [dot(status.daemonRunning ? "ok" : "off"), status.daemonRunning ? "运行中" : "已停止"])),
    row("拦截器", el("span", { class: "status" }, [dot(interceptorDot), interceptorText])),
    row("Hook", el("span", { class: "chips" }, [
      el("span", { class: "chip", text: status.hook || "未知" }),
      status.api ? el("span", { class: "chip", text: "API " + status.api }) : null,
    ])),
  ]);
  if (status.reachable === false) {
    card.appendChild(el("div", { class: "banner" }, [
      el("div", { text: "无法连接守护进程状态接口。" }),
      el("div", { class: "muted small", text: status.error || "守护进程暂未响应。" }),
    ]));
  }
  return card;
}

// --- harvest summary -----------------------------------------------------
// A deliberately honest dump of the device state the daemon harvested, split into two groups.
// "Captured" is ONLY what the real TEE key generation actually reported (raw, never overwritten): the
// verified-boot key/hash — shown even when all-zero — lock/boot state, patch and OS levels, security
// levels, versions, and the device ids the leaf actually carried. A captured value that we do not present
// (it has a fabricated counterpart) is struck + red. "Fabricated" is the layer we present on top: values
// forced for attestation (deviceLocked, Verified), ids read from the OS because the leaf omits them, and,
// on a device with no working hardware, a synthesized level/version.
//
// The fabricated values the user may edit (synthesized level/version, and an all-zero verified-boot
// key/hash) get an inline editor; the rest are read-only, badged by source. Ids are shown but not editable
// here — spoofing an id is a per-profile concern in the profile editor (that is what "override" means).
//
// The harvest level the user last selected, kept across the status poll so a StrongBox click doesn't snap
// back to TrustedEnvironment a few seconds later.
let harvestMode = "tee";

function harvestCard(status, actions = {}) {
  const h = status && status.harvest;
  const card = el("div", { class: "card" }, [el("h2", { text: "设备信息采集" })]);
  if (!status) { card.appendChild(el("p", { class: "muted", text: "—" })); return card; }
  if (!h) { card.appendChild(el("p", { class: "muted", text: "暂无设备信息采集记录。" })); return card; }

  const failed = !!h.harvestFailed;
  // overrides: { field: { value, source, editable, userEdited } }. `value` is the machine form (level
  // integer, "true", hex); the display formatting per field happens in fmtOverrideValue.
  const overrides = (h.overrides && typeof h.overrides === "object" && !Array.isArray(h.overrides)) ? h.overrides : {};
  const sbAvailable = !!h.strongBoxAvailable;
  const modes = [
    { key: "tee", label: "TrustedEnvironment" },
    { key: "strongbox", label: "StrongBox" },
  ];
  if (failed || !modes.some((m) => m.key === harvestMode)) harvestMode = "tee";
  const chipEls = modes.map((m) =>
    el("button", { class: "chip clickable", type: "button", onclick: () => select(m.key) }, [
      el("span", { class: "dot ok" }),
      el("span", { text: m.label }),
    ]),
  );
  if (!failed) card.appendChild(el("div", { class: "harvest-modes" }, chipEls));

  const body = el("div", { class: "harvest-body" });
  // Captured is chip-dependent (StrongBox reads a different level), so it is rebuilt on every chip click.
  // The Overrides group does not depend on the chip and holds the edit inputs, so it is built once and
  // left untouched — a chip click never tears down a value being typed.
  const capturedBox = el("div");
  body.appendChild(capturedBox);
  card.appendChild(body);

  function select(m) {
    harvestMode = m;
    modes.forEach((mode, i) => chipEls[i].classList.toggle("selected", mode.key === m));
    renderCaptured();
  }

  function renderCaptured() {
    capturedBox.replaceChildren();
    const sb = harvestMode === "strongbox";
    if (failed) {
      capturedBox.appendChild(el("div", { class: "muted small", text: "未能获取任何密钥证明（部分机型解锁引导加载程序后会出现），因此未采集到信息，下方各值均为合成值。" }));
      return;
    }
    if (sb && !sbAvailable) {
      capturedBox.appendChild(el("div", { class: "muted small", text: "本设备没有可用的 StrongBox 硬件。请求 StrongBox 级别的密钥时，将使用 TEE 版本参数生成软件密钥，而非修补硬件证明。" }));
    }
    capturedBox.appendChild(el("h3", { text: "原始采集值" }));
    const rows = el("div", { class: "kv-list" });
    // Show ONLY genuinely captured values. A field the leaf did not carry (null/undefined/empty) gets no
    // row at all — never a "—" or any other placeholder. Every value passed here is the raw capture. A
    // value that has a fabricated counterpart (it is what the device reported but NOT what we present) is
    // struck + red; the value we present for it shows in the Fabricated group below.
    const add = (label, val) => {
      if (val != null && val !== "") rows.appendChild(kvRow(label, String(val), overrides[label] != null));
    };

    add("verifiedBootState", h.verifiedBootState == null ? null : named(h.verifiedBootState) + " (" + h.verifiedBootState + ")");
    add("deviceLocked", h.deviceLocked == null ? null : String(h.deviceLocked));
    if (h.verifiedBootKey) hexRow(rows, "verifiedBootKey", h.verifiedBootKey, overrides["verifiedBootKey"] != null);
    if (h.verifiedBootHash) hexRow(rows, "verifiedBootHash", h.verifiedBootHash, overrides["verifiedBootHash"] != null);
    add("osVersion", h.osVersion);
    add("osPatchLevel", h.osPatchLevel);
    add("vendorPatchLevel", h.vendorPatchLevel);
    add("bootPatchLevel", h.bootPatchLevel);
    // The device has one real captured level. StrongBox reads level 2 only when it actually works;
    // otherwise it shows the captured level. Only render when the level was actually captured.
    const sbReal = sb && sbAvailable;
    add("attestationSecurityLevel", h.attestationSecurityLevel == null ? null : secLevel(sbReal ? 2 : h.attestationSecurityLevel));
    add("keymasterSecurityLevel", h.keymasterSecurityLevel == null ? null : secLevel(sbReal ? 2 : h.keymasterSecurityLevel));
    add("attestationVersion", sbReal ? h.strongBoxAttestationVersion : h.attestationVersion);
    add("keymasterVersion", h.keymasterVersion);
    if (h.moduleHash) hexRow(rows, "moduleHash", h.moduleHash, overrides["moduleHash"] != null);
    // Device identity — only the ids the TEE actually attested (serial/imei are usually absent, and now
    // shown under Overrides as supplements rather than falsely claimed here).
    for (const key of ["brand", "device", "product", "manufacturer", "model", "serial", "imei", "meid", "imei2"]) {
      if (h[key]) add(key, h[key]);
    }
    if (h.harvestedAt) add("harvestedAt", fmtTime(h.harvestedAt));
    capturedBox.appendChild(rows);
  }

  select(harvestMode);
  const ov = overridesGroup(overrides, actions);
  if (ov) body.appendChild(ov);
  return card;
}

// The Fabricated group: every field we present in place of (or absent from) the raw capture, each with a
// source badge. Editable ones (synthesized level/version, all-zero boot key/hash) get an inline editor.
function overridesGroup(overrides, actions) {
  const fields = ORDER.filter((f) => overrides[f]).concat(
    Object.keys(overrides).filter((f) => !ORDER.includes(f)),
  );
  if (!fields.length) return null;
  const box = el("div");
  box.appendChild(el("h3", { text: "Fabricated（替代与合成值）" }));
  const rows = el("div", { class: "kv-list" });
  for (const field of fields) rows.appendChild(overrideRow(field, overrides[field], actions));
  box.appendChild(rows);
  return box;
}

// A stable, readable order for the override rows (unknown fields fall to the end).
const ORDER = [
  "deviceLocked", "verifiedBootState", "verifiedBootKey", "verifiedBootHash",
  "attestationSecurityLevel", "keymasterSecurityLevel", "attestationVersion", "keymasterVersion",
  "moduleHash", "osVersion", "osPatchLevel", "vendorPatchLevel", "bootPatchLevel",
  "serial", "imei", "imei2", "meid",
];

// Display labels only; JSON fields and override requests keep their original keys.
const FIELD_LABELS = {
  deviceLocked: "设备已锁定", verifiedBootState: "验证启动状态",
  verifiedBootKey: "验证启动密钥", verifiedBootHash: "验证启动哈希",
  attestationSecurityLevel: "证明安全级别", keymasterSecurityLevel: "Keymaster 安全级别",
  attestationVersion: "证明版本", keymasterVersion: "Keymaster 版本",
  moduleHash: "模块哈希", osVersion: "系统版本", osPatchLevel: "系统安全补丁",
  vendorPatchLevel: "厂商安全补丁", bootPatchLevel: "启动安全补丁",
  brand: "品牌", device: "设备代号", product: "产品代号", manufacturer: "制造商",
  model: "型号", serial: "序列号", imei: "IMEI", imei2: "IMEI2", meid: "MEID",
  harvestedAt: "采集时间",
};

function fieldLabel(key) {
  return FIELD_LABELS[key] || key;
}

const SOURCE_LABEL = { required: "required", supplement: "supplement", synthesized: "synthesized" };
const HEX_FIELDS = new Set(["verifiedBootKey", "verifiedBootHash", "moduleHash"]);

function overrideRow(field, o, actions) {
  const badge = el("span", { class: "badge badge-" + (o.source || "required"), text: SOURCE_LABEL[o.source] || o.source || "" });
  const edited = o.userEdited ? el("span", { class: "badge badge-edited", text: "已修改" }) : null;
  const label = el("span", { class: "kv-label", title: field }, [fieldLabel(field), badge, edited]);

  if (!o.editable) {
    const val = el("span", { class: "kv-val" + (HEX_FIELDS.has(field) ? " mono kv-hex" : ""), text: fmtOverrideValue(field, o.value) });
    return el("div", { class: "kv" + (HEX_FIELDS.has(field) ? " kv-stack" : "") }, [label, val]);
  }

  // Editable: an inline editor + Save, and Reset (revert to the computed default) when user-edited.
  const input = editorFor(field, o.value);
  const save = el("button", {
    class: "btn small", type: "button",
    onclick: () => actions.onSaveOverride && actions.onSaveOverride(field, String(input.value).trim()),
  }, "保存");
  const reset = o.userEdited
    ? el("button", { class: "linklike small", type: "button", onclick: () => actions.onResetOverride && actions.onResetOverride(field) }, "重置")
    : null;
  return el("div", { class: "kv kv-stack" }, [label, el("div", { class: "ov-edit" }, [input, save, reset])]);
}

// The right input for an editable field: a level picker, a version number, or a 64-hex boot value.
function editorFor(field, value) {
  if (field === "attestationSecurityLevel" || field === "keymasterSecurityLevel") {
    const sel = el("select", { class: "ov-input" });
    for (const [n, name] of [[0, "Software"], [1, "TrustedEnvironment"], [2, "StrongBox"]]) {
      const opt = el("option", { value: String(n), text: name + " (" + n + ")" });
      if (String(n) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    }
    return sel;
  }
  if (HEX_FIELDS.has(field)) {
    return el("input", { class: "ov-input mono", type: "text", value: value || "", maxlength: "64",
      spellcheck: "false", autocapitalize: "none", placeholder: "64 位十六进制字符" });
  }
  return el("input", { class: "ov-input", type: "number", inputmode: "numeric", value: value || "" });
}

// Display formatting for an override's machine value, by field.
function fmtOverrideValue(field, value) {
  if (value == null || value === "") return "—";
  if (field === "verifiedBootState") return named(Number(value)) + " (" + value + ")";
  if (field === "attestationSecurityLevel" || field === "keymasterSecurityLevel") return secLevel(Number(value));
  return String(value);
}

function secLevel(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const names = ["Software", "TrustedEnvironment", "StrongBox"];
  return (typeof n === "number" && names[n] ? names[n] : String(n)) + " (" + n + ")";
}

function kvRow(label, val, replaced) {
  return el("div", { class: "kv" + (replaced ? " kv-replaced" : "") }, [
    el("span", { class: "kv-label", text: fieldLabel(label), title: label }),
    el("span", { class: "kv-val", text: val }),
  ]);
}

// A verified-boot key / hash / module hash: hex in the record already, shown wrapping so the raw
// bytes are visible. An all-zero value is flagged (it is what an unlocked device reports, and worth
// spotting). `replaced` struck + red when it has a fabricated counterpart.
function hexRow(rows, label, hex, replaced) {
  const allZero = hex && /^0+$/i.test(hex);
  const flag = allZero ? el("span", { class: "chip warn small", text: "全零" }) : null;
  rows.appendChild(el("div", { class: "kv kv-stack" + (replaced ? " kv-replaced" : "") }, [
    el("span", { class: "kv-label", title: label }, [fieldLabel(label), flag]),
    el("span", { class: "mono kv-hex", text: hex || "—" }),
  ]));
}

function fmtTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try { return new Date(n).toLocaleString(); } catch { return String(ms); }
}

// --- canary updater ------------------------------------------------------
function updateCard(s, actions) {
  const { update, probed, variant, installing, installError, notesOpen } = s;
  const card = el("div", { class: "card" }, [el("h2", { text: "更新" })]);

  // Probe hasn't resolved, or the daemon was unreachable: say so, no controls.
  if (!update) {
    card.appendChild(el("p", { class: "muted", text: probed ? "无法获取更新状态：守护进程不可达。" : "正在检查更新…" }));
    return card;
  }

  const installed = update.installedVersion || (update.currentCode ? "构建 " + update.currentCode : "未知");
  card.appendChild(row("已安装版本", el("span", { class: "mono small", text: installed })));

  const latest = update.latest;
  if (!latest) {
    card.appendChild(el("p", { class: "muted small", text: "尚未发布测试版本。" }));
    return card;
  }

  if (!update.updateAvailable) {
    card.appendChild(el("div", { class: "status" }, [el("span", { class: "dot ok" }), el("span", { text: "已是最新测试版本。" })]));
    return card;
  }

  // An update is available: headline pill, what's-new disclosure, variant + Install.
  card.appendChild(el("div", { class: "update-head" }, [
    el("span", { class: "pill warn", text: "有可用更新" }),
    el("span", { class: "mono small", text: "canary-" + (latest.code || "?") }),
  ]));
  if (latest.name) card.appendChild(el("div", { class: "small", text: latest.name }));

  card.appendChild(disclosure("更新内容", whatsNew(latest), {
    open: notesOpen, onToggle: actions.onToggleNotes, id: "sys-notes",
  }));

  // Variant picker (which asset to flash) + the one primary action on this screen.
  card.appendChild(el("div", { class: "field" }, [
    el("span", { class: "field-label", text: "构建类型" }),
    segmented(variant, ["release", "debug"], actions.onSelectVariant, installing),
  ]));

  card.appendChild(el("div", { class: "update-actions" }, [
    installing
      ? el("span", { class: "status" }, [el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { class: "muted small", text: "正在下载并刷入…" })])
      : el("span", { class: "muted small", text: "将" + ({ release: "正式版", debug: "调试版" })[variant] + " 覆盖刷入当前模块，重启后生效。" }),
    el("button", {
      class: "btn primary", text: installing ? "正在安装…" : "安装",
      disabled: installing, onclick: () => actions.onInstall(),
    }),
  ]));

  if (installError) {
    card.appendChild(el("div", { class: "banner error" }, [
      el("div", { text: "安装失败" }),
      el("div", { class: "muted small", text: installError }),
    ]));
  }
  return card;
}

const REPO_URL = "https://github.com/asmantur/TEESimulator-";

function whatsNew(latest) {
  const nodes = [];
  if (latest.tag) nodes.push(el("div", { class: "muted small mono", text: latest.tag }));
  // Links to inspect the build on GitHub: the exact commit and the release page.
  const links = [];
  if (latest.commit) {
    links.push(el("a", { class: "linklike mono small", href: REPO_URL + "/commit/" + latest.commit,
      target: "_blank", rel: "noreferrer", text: "提交 " + String(latest.commit).slice(0, 7) }));
  }
  if (latest.htmlUrl) {
    links.push(el("a", { class: "linklike small", href: latest.htmlUrl, target: "_blank", rel: "noreferrer", text: "发布页面 ↗" }));
  }
  if (links.length) nodes.push(el("div", { class: "update-links" }, links));
  if (latest.notes) nodes.push(el("div", { class: "notes small md" }, renderMarkdown(latest.notes)));
  const assets = Array.isArray(latest.assets) ? latest.assets : [];
  if (assets.length) {
    nodes.push(el("div", { class: "muted small", text: "发布文件" }));
    nodes.push(el("ul", { class: "asset-list" }, assets.map((a) =>
      el("li", { class: "asset-row" }, [
        el("span", { class: "mono small", text: a.name || "（未命名）" }),
        el("span", { class: "muted small", text: humanSize(a.size) }),
      ]))));
  }
  if (!nodes.length) nodes.push(el("p", { class: "muted small", text: "暂无更新说明。" }));
  return nodes;
}

// --- small shared bits ---------------------------------------------------
function segmented(value, options, onSelect, disabled) {
  return el("div", { class: "segmented", role: "group", "aria-label": "构建类型" },
    options.map((opt) => el("button", {
      type: "button", class: "seg" + (opt === value ? " on" : ""),
      "aria-pressed": opt === value ? "true" : "false", disabled: !!disabled,
      text: ({ release: "正式版", debug: "调试版" })[opt] || opt,
      onclick: () => onSelect(opt),
    })));
}

function row(label, valueNode) {
  return el("div", { class: "row" }, [el("span", { text: label }), valueNode]);
}

function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + " " + units[i];
}

// verifiedBootState is 0 Verified, 1 SelfSigned, 2 Unverified, 3 Failed.
function named(state) {
  const names = ["Verified", "SelfSigned", "Unverified", "Failed"];
  if (state == null) return null;
  return typeof state === "number" && names[state] ? names[state] : String(state);
}
