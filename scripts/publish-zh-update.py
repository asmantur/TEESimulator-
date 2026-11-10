#!/usr/bin/env python3
"""Atomically publish update metadata to the updates branch, without switching HEAD."""
from pathlib import Path
import os
import subprocess
import tempfile


def run(*args, env=None, input=None, check=True):
    return subprocess.run(["git", *args], env=env, input=input, text=True,
                          capture_output=True, check=check)


def publish(directory):
    files = {name: Path(directory, name).read_text() for name in ("update.json", "changelog.md")}
    remote = run("ls-remote", "--exit-code", "origin", "refs/heads/updates", check=False)
    parent = None
    if remote.returncode == 0:
        run("fetch", "--no-tags", "origin", "refs/heads/updates")
        parent = run("rev-parse", "FETCH_HEAD^{commit}").stdout.strip()
    elif remote.returncode != 2:
        raise RuntimeError(remote.stderr)
    with tempfile.TemporaryDirectory(prefix="teesim-updates-") as temp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(temp, "index"))}
        # Preserve any existing branch files; only replace the two metadata files.
        run("read-tree", f"{parent}^{{tree}}" if parent else "--empty", env=env)
        for name, content in files.items():
            blob = run("hash-object", "-w", "--stdin", input=content).stdout.strip()
            run("update-index", "--add", "--cacheinfo", f"100644,{blob},{name}", env=env)
        tree = run("write-tree", env=env).stdout.strip()
    if parent and tree == run("rev-parse", f"{parent}^{{tree}}").stdout.strip():
        print("Update metadata already current")
        return
    args = ["-c", "user.name=github-actions[bot]", "-c",
            "user.email=41898282+github-actions[bot]@users.noreply.github.com",
            "commit-tree", tree]
    if parent:
        args += ["-p", parent]
    commit = run(*args, input="Update Chinese module download metadata\n").stdout.strip()
    # A concurrent update rejects this normal push; never replace remote history.
    run("push", "origin", f"{commit}:refs/heads/updates")
    print("Published update metadata to updates branch")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", default="out")
    publish(parser.parse_args().directory)
