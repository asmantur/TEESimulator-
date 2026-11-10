#!/usr/bin/env python3
"""Merge a pinned fetched upstream commit locally; never push or resolve conflicts."""
import argparse
import os
from pathlib import Path
import subprocess


def git(*args, check=True):
    return subprocess.run(["git", *args], text=True, capture_output=True, check=check)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-url", default="https://github.com/JingMatrix/TEESimulator.git")
    parser.add_argument("--branch", default="dev")
    parser.add_argument("--report", type=Path, default=Path("/tmp/teesim-sync-report.md"))
    args = parser.parse_args()
    report = ["# 中文版自动同步报告", ""]
    try:
        git("check-ref-format", "--branch", args.branch)
        if git("status", "--porcelain").stdout.strip():
            raise RuntimeError("工作区有未提交改动；同步已停止，不会覆盖本地文件。")
        before = git("rev-parse", "HEAD").stdout.strip()
        git("fetch", "--no-tags", "--", args.upstream_url, f"refs/heads/{args.branch}")
        upstream = git("rev-parse", "FETCH_HEAD^{commit}").stdout.strip()
        report += [f"同步前：`{before}`", f"上游提交：`{upstream}`", ""]
        # Reject unrelated history rather than manufacturing a replacement branch.
        git("merge-base", "HEAD", upstream)
        changed = git("merge-base", "--is-ancestor", upstream, "HEAD", check=False).returncode
        if changed not in (0, 1):
            raise RuntimeError("无法检查提交祖先关系。")
        if changed:
            result = git("-c", "user.name=github-actions[bot]", "-c",
                         "user.email=41898282+github-actions[bot]@users.noreply.github.com",
                         "merge", "--no-ff", "--no-edit", upstream, check=False)
            if result.returncode:
                conflicts = git("diff", "--name-only", "--diff-filter=U").stdout.strip()
                if conflicts:
                    report += ["## 合并冲突", "", "```text", conflicts, "```", ""]
                    git("merge", "--abort")
                    raise RuntimeError("上游与汉化文件冲突；已中止合并，需要维护者处理。")
                raise RuntimeError(result.stderr or result.stdout)
        after = git("rev-parse", "HEAD").stdout.strip()
        report += ["已合并，等待汉化、测试与构建检查。" if changed else "上游无新提交。"]
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as output:
                output.write(f"changed={'true' if changed else 'false'}\nbase_sha={before}\nupstream_sha={upstream}\nhead_sha={after}\n")
        print(report[-1])
    except (RuntimeError, subprocess.CalledProcessError) as error:
        detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        report += ["## 已停止", "", "```text", detail or str(error), "```"]
        raise SystemExit(detail or str(error)) from error
    finally:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text("\n".join(report) + "\n", encoding="utf8")


if __name__ == "__main__":
    main()
