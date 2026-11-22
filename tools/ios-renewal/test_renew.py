import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import renew


class DevicePushTest(unittest.TestCase):
    def test_two_phones_fetch_independently_and_never_install_a_stale_build(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "origin"
            remote.mkdir()
            subprocess.run(["git", "init", "-b", "main"], cwd=remote, check=True)

            def advance_main():
                subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=t@example.com",
                                "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "main"],
                               cwd=remote, check=True, stdout=subprocess.DEVNULL)
                return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=remote, text=True).strip()

            def receipt(device):
                return root / f"installed-{device}.json"

            first = advance_main()
            settings = {"origin": str(remote), "team": "EXAMPLETEAM"}
            (root / ".env.production").write_text("EXPO_PUBLIC_TEST=fixture\n")
            cache = root / "cache"
            commands = []
            installs = []
            real_run = subprocess.run

            def run(args, **kwargs):
                if args[0] in ("npm", "npx"):
                    commands.append(args)
                    self.assertEqual(kwargs["cwd"], cache / "worktree")
                    self.assertEqual((kwargs["cwd"] / ".env.production").read_text(),
                                     "EXPO_PUBLIC_TEST=fixture\n")
                elif args[0] == "/usr/bin/xcrun":
                    if "install" in args:
                        installs.append(args[args.index("--device") + 1])
                else:
                    return real_run(args, **kwargs)

            expires = datetime.now(timezone.utc) + timedelta(days=7)
            with patch.object(renew, "HERE", root), patch.object(renew, "CACHE", cache), \
                 patch.object(subprocess, "run", side_effect=run), \
                 patch.object(renew, "build", return_value=(root / "test.app", {}, expires)) as build:
                renew.renew_phone("one", "1", settings, False, False)
                self.assertEqual(json.loads(receipt("1").read_text())["commit"], first)
                second = advance_main()
                renew.renew_phone("two", "2", settings, False, False)
                self.assertEqual(json.loads(receipt("2").read_text())["commit"], second)
                self.assertFalse((cache / "worktree").exists())
                self.assertEqual(commands, [
                    ["npm", "ci", "--include=dev"],
                    ["npx", "expo", "prebuild", "--platform", "ios", "--clean"],
                ] * 2)
                self.assertEqual([call.args[3] for call in build.call_args_list], [settings["team"]] * 2)
                remote.rename(root / "offline")
                old_receipt = receipt("1").read_bytes()
                with self.assertRaises(subprocess.CalledProcessError):
                    renew.renew_phone("one", "1", settings, False, True)
                self.assertEqual(receipt("1").read_bytes(), old_receipt)
                self.assertEqual(installs, ["1", "2"])
                self.assertEqual(build.call_count, 2)


if __name__ == "__main__":
    unittest.main()
