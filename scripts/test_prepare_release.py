from pathlib import Path
import json
import os
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name("prepare-zh-release.py")


class ReleaseTests(unittest.TestCase):
    def test_descriptor_points_at_verified_chinese_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "out").mkdir()
            for variant in ("Release", "Debug"):
                with ZipFile(root / f"out/TEESimulator-test-{variant}.zip", "w") as archive:
                    archive.writestr("module.prop", "id=teesim\nversion=test\nversionCode=42\n")
                    archive.writestr("webroot/index.html", '<html lang="zh-CN">')
                    archive.writestr("classes.dex", "fixture")
                    for abi in ("arm64-v8a", "x86_64"):
                        for name in ("inject", "teesim-uds", "libteesim_keymint.so", "libteesim_keystore.so"):
                            archive.writestr(f"{abi}/{name}", "fixture")
            output = root / "github-output"
            env = {**os.environ, "GITHUB_REPOSITORY": "example/repo", "GITHUB_RUN_ID": "123", "GITHUB_OUTPUT": str(output)}
            result = subprocess.run(["python3", str(SCRIPT)], cwd=root, env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            descriptor = json.loads((root / "out/update.json").read_text())
            self.assertEqual(descriptor["versionCode"], 42)
            self.assertEqual(descriptor["zipUrl"], "https://github.com/example/repo/releases/download/canary-42/TEESimulator-test-Release.zip")
            self.assertIn("tag=canary-42", output.read_text())
            self.assertEqual(len((root / "out/SHA256SUMS").read_text().splitlines()), 2)
            # Incomplete or accidentally English builds must never update the descriptor.
            with ZipFile(root / "out/TEESimulator-test-Release.zip", "w") as archive:
                archive.writestr("module.prop", "id=teesim\nversionCode=43\n")
                archive.writestr("webroot/index.html", '<html lang="en">')
            failed = subprocess.run(["python3", str(SCRIPT)], cwd=root, env=env, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(json.loads((root / "out/update.json").read_text()), descriptor)


if __name__ == "__main__":
    unittest.main()
