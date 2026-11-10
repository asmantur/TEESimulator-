#!/usr/bin/env python3
"""Read SDK/NDK/JDK pins from the merged app, failing on ambiguous changes."""
from pathlib import Path
import re

app = Path("app/build.gradle.kts").read_text()
for name, pattern in {
    "NDK_VERSION": r'ndkVersion\s*=\s*"([\d.]+)"',
    "BUILD_TOOLS_VERSION": r'buildToolsVersion\s*=\s*"([\d.]+)"',
    "COMPILE_SDK": r'compileSdk\s*=\s*(\d+)',
    "JAVA_VERSION": r'sourceCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)',
}.items():
    found = re.findall(pattern, app)
    if len(found) != 1:
        raise SystemExit(f"无法确定 {name}，请人工更新构建环境读取脚本。")
    print(f"{name}={found[0]}")
