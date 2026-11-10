from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("publish-zh-update.py")


class PublishTests(unittest.TestCase):
    def test_creates_metadata_branch_without_moving_dev(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            repo = root / "repo"
            subprocess.run(["git", "init", "-b", "dev", str(repo)], check=True, capture_output=True)
            def git(*args):
                return subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
                                      cwd=repo, capture_output=True, text=True, check=True).stdout.strip()
            git("commit", "--allow-empty", "-m", "source")
            git("remote", "add", "origin", str(remote))
            git("push", "origin", "dev")
            head = git("rev-parse", "HEAD")
            metadata = root / "metadata"
            metadata.mkdir()
            (metadata / "update.json").write_text("{}\n")
            (metadata / "changelog.md").write_text("中文\n")
            result = subprocess.run(["python3", str(SCRIPT), "--directory", str(metadata)],
                                    cwd=repo, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            git("fetch", "origin", "updates")
            self.assertEqual(git("ls-tree", "--name-only", "FETCH_HEAD").splitlines(), ["changelog.md", "update.json"])
            self.assertEqual(git("rev-parse", "HEAD"), head)
            self.assertEqual(git("status", "--porcelain"), "")

    def test_atomic_metadata_publication_preserves_source_and_remote_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, remote = root / "source", root / "remote.git"

            def git(*args, cwd=repo):
                return subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
                                      cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

            git("init", "--bare", str(remote), cwd=root)
            git("init", "-b", "dev", str(repo), cwd=root)
            (repo / "source.txt").write_text("keep source")
            git("add", ".")
            git("commit", "-m", "source")
            git("remote", "add", "origin", str(remote))
            git("push", "origin", "dev")
            head = git("rev-parse", "HEAD")
            # An existing branch can contain other user files; keep them.
            git("branch", "updates")
            git("checkout", "updates")
            (repo / "keep.txt").write_text("user file")
            git("add", "keep.txt")
            git("commit", "-m", "keep")
            git("push", "origin", "updates")
            git("checkout", "dev")
            metadata = root / "metadata"
            metadata.mkdir()
            (metadata / "update.json").write_text('{"versionCode":42}\n')
            (metadata / "changelog.md").write_text("中文更新说明\n")

            def publish():
                return subprocess.run(["python3", str(SCRIPT), "--directory", str(metadata)],
                                      cwd=repo, text=True, capture_output=True)

            result = publish()
            self.assertEqual(result.returncode, 0, result.stderr)
            git("fetch", "origin", "updates")
            published = git("rev-parse", "FETCH_HEAD")
            self.assertEqual(git("show", "FETCH_HEAD:keep.txt"), "user file")
            self.assertEqual(git("show", "FETCH_HEAD:update.json"), '{"versionCode":42}')
            self.assertEqual(head, git("rev-parse", "HEAD"))
            self.assertEqual(git("status", "--porcelain"), "")
            self.assertEqual(publish().returncode, 0)
            git("fetch", "origin", "updates")
            self.assertEqual(git("rev-parse", "FETCH_HEAD"), published)


if __name__ == "__main__":
    unittest.main()
