"""Exercise merges against local repos without GitHub access or credentials."""
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("sync-upstream.py")


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.upstream = self.root / "upstream"
        self.fork = self.root / "fork"
        self.report = self.root / "report.md"
        self.run_git(self.root, "init", "-b", "dev", str(self.upstream))
        self.commit(self.upstream, "base.txt", "base")
        self.run_git(self.root, "clone", str(self.upstream), str(self.fork))
        self.commit(self.fork, "chinese.txt", "汉化")

    def run_git(self, repo, *args):
        return subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
                              cwd=repo, text=True, capture_output=True, check=True).stdout.strip()

    def commit(self, repo, file, text):
        (repo / file).write_text(text, encoding="utf8")
        self.run_git(repo, "add", file)
        self.run_git(repo, "commit", "-m", file)

    def sync(self):
        return subprocess.run(["python3", str(SCRIPT), "--upstream-url", str(self.upstream),
                               "--report", str(self.report)], cwd=self.fork, text=True, capture_output=True)

    def test_merge_and_repeat_preserve_chinese(self):
        self.commit(self.upstream, "new.txt", "new upstream")
        self.assertEqual(self.sync().returncode, 0)
        self.assertEqual((self.fork / "chinese.txt").read_text(), "汉化")
        self.assertEqual((self.fork / "new.txt").read_text(), "new upstream")
        head = self.run_git(self.fork, "rev-parse", "HEAD")
        self.assertEqual(self.sync().returncode, 0)
        self.assertEqual(head, self.run_git(self.fork, "rev-parse", "HEAD"))

    def test_conflict_aborts_without_losing_work(self):
        self.commit(self.fork, "base.txt", "中文版")
        self.commit(self.upstream, "base.txt", "changed upstream")
        head = self.run_git(self.fork, "rev-parse", "HEAD")
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertEqual(head, self.run_git(self.fork, "rev-parse", "HEAD"))
        self.assertEqual(self.run_git(self.fork, "status", "--porcelain"), "")
        self.assertIn("base.txt", self.report.read_text())

    def test_dirty_worktree_is_preserved(self):
        (self.fork / "untracked.txt").write_text("用户文件")
        self.assertNotEqual(self.sync().returncode, 0)
        self.assertEqual((self.fork / "untracked.txt").read_text(), "用户文件")


if __name__ == "__main__":
    unittest.main()
