// Pure, DOM-free validators driven entirely off the schema. Every error is hard
// (it blocks Save); there is no warnings tier. Exercised directly by
// tests/domain.test.mjs, which is why nothing here touches the DOM or the bridge.

import {
  FIELDS, KEYBOX_RE, APP_ENTRY_RE, PROFILE_RE, VERSION,
} from "./schema.js";
import { getPath } from "./path.js";

// Validate one profile in isolation (no cross-profile knowledge here).
// Returns an array of { field, msg }; field matches a descriptor.key, or the
// synthetic "__name" for the profile name itself.
export function validateProfile(name, profile) {
  const errors = [];

  if (!PROFILE_RE.test(name)) {
    errors.push({ field: "__name", msg: "名称须为 1–32 个字符，仅支持英文字母、数字、- 或 _。" });
  }
  if (!profile || typeof profile !== "object") {
    errors.push({ field: "__name", msg: "方案必须为对象。" });
    return errors;
  }

  for (const f of FIELDS) {
    const value = getPath(profile, f.path);

    if (f.type === "applist" || f.type === "scope") {
      const apps = Array.isArray(value) ? value : [];
      // "At least one app" no longer holds when auto-include covers the profile: an empty
      // apps list is fine precisely when autoIncludeNewApps is on (the daemon then targets
      // every unclaimed user app, so there is nothing to hand-pick).
      const autoIncludes = profile.autoIncludeNewApps === true;
      if (f.required && apps.length < 1 && !autoIncludes) {
        errors.push({ field: f.key, msg: "请至少选择一个应用，或开启“自动纳入新应用”。" });
      }
      // Each entry is a package name, a package@user name, OR a raw uid: token (APP_ENTRY_RE),
      // not package-only.
      for (const entry of apps) {
        if (typeof entry !== "string" || !APP_ENTRY_RE.test(entry)) {
          errors.push({ field: f.key, msg: `应用条目无效：${entry}` });
        }
      }
      continue;
    }

    if (f.key === "keybox") {
      if (!value || !KEYBOX_RE.test(value)) {
        errors.push({ field: f.key, msg: "请指定以 .xml 结尾的密钥箱文件。" });
      }
      continue;
    }

    // A toggle carries a boolean, not a string, so it is never format-checked (its regex-less
    // descriptor already skips the scalar branch below, but guard explicitly so a future
    // required/re on a non-string type can't misfire against the empty-string check).
    if (f.type === "toggle") continue;

    // Generic scalar. Format is checked only when a value is present, so an
    // optional field left blank is fine; presence is a separate, explicit flag.
    if (f.re && value !== undefined && value !== "" && !f.re.test(value)) {
      errors.push({ field: f.key, msg: `${f.label}无效：${value}` });
    }
    if (f.required && (value === undefined || value === "")) {
      errors.push({ field: f.key, msg: `请填写${f.label}。` });
    }
  }

  return errors;
}

// Validate the whole config, including the one rule no single profile can see:
// a package may appear in at most one profile (routing is package -> one profile).
// Returns { ok, errors: [{ profile, field, msg }] }.
export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: [{ profile: null, field: null, msg: "配置必须为对象。" }] };
  }
  if (config.version !== VERSION) {
    errors.push({ profile: null, field: null, msg: `不支持此版本，需要版本 ${VERSION}。` });
  }
  const profiles = config.profiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    errors.push({ profile: null, field: null, msg: "配置中的 profiles 必须为对象。" });
    return { ok: errors.length === 0, errors };
  }

  // Per-profile checks.
  for (const name of Object.keys(profiles)) {
    for (const e of validateProfile(name, profiles[name])) {
      errors.push({ profile: name, field: e.field, msg: e.msg });
    }
  }

  // Cross-profile: which profiles claim each package? Dedup within a profile
  // first (new Set) so a package listed twice in ONE profile is a single claim,
  // not a false cross-profile duplicate.
  const owners = new Map(); // pkg -> [profileName, ...] (distinct profiles)
  for (const name of Object.keys(profiles)) {
    const apps = Array.isArray(profiles[name] && profiles[name].apps) ? profiles[name].apps : [];
    for (const pkg of new Set(apps)) {
      if (!owners.has(pkg)) owners.set(pkg, []);
      owners.get(pkg).push(name);
    }
  }
  for (const [pkg, claimants] of owners) {
    if (claimants.length > 1) {
      for (const name of claimants) {
        errors.push({
          profile: name, field: "apps",
          msg: `应用条目 ${pkg} 同时属于 ${claimants.length} 个方案，每个条目只能属于一个方案。`,
        });
      }
    }
  }

  // Auto-include is a whole-device catch-all ("every unclaimed user app"), so two profiles
  // both asking for it would fight over the same apps — the daemon allows at most one. Flag
  // every offender so the user sees exactly which profiles to reconcile.
  const autoProfiles = Object.keys(profiles).filter(
    (name) => profiles[name] && profiles[name].autoIncludeNewApps === true);
  if (autoProfiles.length > 1) {
    for (const name of autoProfiles) {
      errors.push({
        profile: name, field: "autoIncludeNewApps",
        msg: `仅允许一个方案自动纳入新应用，目前有 ${autoProfiles.length} 个方案启用了此功能。`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
