#!/usr/bin/env python3
"""Inspect built ZIP metadata and generate the root-manager update descriptor."""
import hashlib
import json
import os
from pathlib import Path
import re
from zipfile import ZipFile

repo = os.environ["GITHUB_REPOSITORY"]
if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
    raise SystemExit("Invalid repository name")
out = Path("out")
archives = {}
metadata = None
for variant in ("Release", "Debug"):
    matches = list(out.glob(f"TEESimulator-*-{variant}.zip"))
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one {variant} ZIP; got {len(matches)}")
    archive = matches[0]
    with ZipFile(archive) as z:
        values = dict(line.split("=", 1) for line in z.read("module.prop").decode().splitlines() if "=" in line)
        if values.get("id") != "teesim" or not values.get("versionCode", "").isdigit():
            raise SystemExit("Invalid module metadata")
        if "zh-CN" not in z.read("webroot/index.html").decode():
            raise SystemExit("Built module is missing the Chinese WebUI")
        if not any(name.endswith(("classes.dex", "service.apk")) for name in z.namelist()):
            raise SystemExit("Built module is missing the daemon")
        for abi in ("arm64-v8a", "x86_64"):
            for file in ("inject", "teesim-uds", "libteesim_keymint.so", "libteesim_keystore.so"):
                if f"{abi}/{file}" not in z.namelist():
                    raise SystemExit(f"Built module is missing {abi}/{file}")
        if metadata and values["versionCode"] != metadata["versionCode"]:
            raise SystemExit("Release/Debug version mismatch")
        metadata = values
    archives[variant] = archive

code = metadata["versionCode"]
tag = f"canary-{code}"
descriptor = {
    "version": f"简体中文 {code}",
    "versionCode": int(code),
    "zipUrl": f"https://github.com/{repo}/releases/download/{tag}/{archives['Release'].name}",
    "changelog": f"https://github.com/{repo}/releases/download/zh-cn-latest/changelog.md",
}
(out / "update.json").write_text(json.dumps(descriptor, ensure_ascii=False, indent=2) + "\n")
(out / "changelog.md").write_text(
    f"# TEESimulator 简体中文版 {code}\n\n"
    "已合并上游更新并通过汉化检查、配置测试、Rust 检查和模块构建。\n\n"
    f"源代码与构建日志：https://github.com/{repo}/actions/runs/{os.environ['GITHUB_RUN_ID']}\n"
)
(out / "SHA256SUMS").write_text("".join(
    f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in archives.values()
))
with open(os.environ["GITHUB_OUTPUT"], "a") as output:
    output.write(f"tag={tag}\ncode={code}\n")
print(f"Verified Release/Debug archives for {tag}")
