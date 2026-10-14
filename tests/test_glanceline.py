#!/usr/bin/env python3
"""Tests for the statusLine fallback: golden parity with the mod's core,
install/uninstall round trips, and a renderer that never fails.

  python3 tests/test_glanceline.py
"""
import importlib.util
import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
from importlib.machinery import SourceFileLoader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "glanceline.py")
loader = SourceFileLoader("glanceline", SCRIPT)
spec = importlib.util.spec_from_loader("glanceline", loader)
G = importlib.util.module_from_spec(spec)
loader.exec_module(G)


def load_cases():
    with open(os.path.join(ROOT, "tests", "cases.ts"), encoding="utf-8") as stream:
        source = stream.read()
    return json.loads(source[source.index("= [") + 2:],
                      object_hook=lambda d: {k: float("nan") if v == "NaN" else v for k, v in d.items()})


HOME = tempfile.mkdtemp(prefix="glanceline-home-")


def run(payload, env=None, args=()):
    full = dict(os.environ, COLUMNS="120", NO_COLOR="1", HOME=HOME)
    full.update(env or {})
    return subprocess.run([sys.executable, SCRIPT, *args], input=payload, capture_output=True, env=full,
                          timeout=10, check=False)


class Golden(unittest.TestCase):
    def test_every_case_matches_the_mod(self):
        cases = load_cases()
        self.assertGreater(len(cases), 100)
        for case in cases:
            with self.subTest(case["name"]):
                if "alerts" in case:
                    self.assertEqual(G.alerts(case["payload"], case["options"]), case["alerts"])
                else:
                    self.assertEqual(G.plain(G.render(case["payload"], case["options"])), case["lines"])


class Rendering(unittest.TestCase):
    PAYLOAD = json.dumps({"session_id": "s1", "model": {"display_name": "Opus 5.5"},
                          "context_window": {"used_percentage": 19}}).encode()

    def test_prints_a_line_and_exits_zero(self):
        done = run(self.PAYLOAD)
        self.assertEqual(done.returncode, 0)
        self.assertEqual(done.stdout.decode().strip(), "Opus 5.5 · ctx 19%")

    def test_never_fails_on_garbage(self):
        rng = random.Random(7)
        samples = [b"", b"null", b"[]", b"{", b"\xff\xfe", b"{\"model\": 5}", b"{\"rate_limits\": []}",
                   b"9" * 300000, json.dumps({"model": {"display_name": "\x1b]0;pwn\x07"}}).encode()]
        samples += [bytes(rng.randrange(256) for _ in range(rng.randrange(1, 200))) for _ in range(20)]
        for sample in samples:
            done = run(sample)
            self.assertEqual(done.returncode, 0, sample[:40])
            self.assertTrue(done.stdout.strip(), sample[:40])
            self.assertNotIn(b"\x1b]", done.stdout)

    def test_steps_aside_while_the_mod_draws_the_same_session(self):
        home = tempfile.mkdtemp(prefix="glanceline-home-")
        live = os.path.join(home, ".cache", "glanceline", "live")
        os.makedirs(live)
        self.assertIn(b"Opus", run(self.PAYLOAD, {"HOME": home}).stdout)
        marker = os.path.join(live, "s1")
        with open(marker, "w") as stream:
            stream.write("1\n")
        self.assertEqual(run(self.PAYLOAD, {"HOME": home}).stdout, b"")
        other = json.dumps({"session_id": "s2", "model": {"display_name": "Opus 5.5"}}).encode()
        self.assertIn(b"Opus", run(other, {"HOME": home}).stdout)
        stale = os.stat(marker).st_mtime - 120
        os.utime(marker, (stale, stale))
        self.assertIn(b"Opus", run(self.PAYLOAD, {"HOME": home}).stdout)
        sneaky = json.dumps({"session_id": "../live/s1", "model": {"display_name": "Opus 5.5"}}).encode()
        self.assertIn(b"Opus", run(sneaky, {"HOME": home}).stdout)

    def test_colors_follow_no_color_and_theme(self):
        colored = run(self.PAYLOAD, {"NO_COLOR": ""}).stdout
        env = dict(os.environ)
        env.pop("NO_COLOR", None)
        done = subprocess.run([sys.executable, SCRIPT], input=self.PAYLOAD, capture_output=True,
                              env=dict(env, COLUMNS="120", GLANCELINE_THEME="color"), check=False)
        self.assertIn(b"\x1b[36m", done.stdout)
        self.assertNotIn(b"\x1b[", colored)

    def test_extra_command_lines_come_below(self):
        done = run(self.PAYLOAD, args=["--extra-command", "echo account you@example.com"])
        self.assertEqual(done.stdout.decode().splitlines()[-1], "account you@example.com")

    def test_preset_from_environment(self):
        done = run(self.PAYLOAD, {"GLANCELINE_PRESET": "minimal"})
        self.assertIn("ctx 19%", done.stdout.decode())

    def test_git_branch_from_the_working_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            if subprocess.run(["git", "init", "-q", "-b", "trunk", folder], check=False).returncode != 0:
                self.skipTest("git unavailable")
            payload = json.dumps({"session_id": "git-test", "model": {"display_name": "M"},
                                  "workspace": {"current_dir": folder}}).encode()
            self.assertIn("trunk", run(payload, {"GLANCELINE_SEGMENTS": "model,git"}).stdout.decode())


class Install(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.settings = os.path.join(self.folder, "settings.json")

    def cli(self, *args):
        return subprocess.run([sys.executable, SCRIPT, *args, "--settings", self.settings,
                               "--command", "/opt/glanceline"], capture_output=True, check=False)

    def test_round_trip_restores_the_file_byte_for_byte(self):
        original = b'{\n    "theme": "dark",\n    "statusLine": {"type": "command", "command": "old.sh", "padding": 1}\n}\n'
        with open(self.settings, "wb") as stream:
            stream.write(original)
        self.assertEqual(self.cli("install").returncode, 0)
        with open(self.settings) as stream:
            data = json.load(stream)
        self.assertEqual(data["theme"], "dark")
        self.assertEqual(data["statusLine"]["command"], "/opt/glanceline")
        self.assertEqual(data["statusLine"]["padding"], 1)
        self.assertEqual(self.cli("install").returncode, 0)   # twice keeps the original
        self.assertEqual(self.cli("uninstall").returncode, 0)
        with open(self.settings, "rb") as stream:
            self.assertEqual(stream.read(), original)

    def test_without_a_previous_status_line_the_key_goes(self):
        with open(self.settings, "w") as stream:
            json.dump({"model": "opus"}, stream)
        self.cli("install")
        with open(self.settings) as stream:
            self.assertIn("statusLine", json.load(stream))
        with open(self.settings, "a") as stream:
            stream.write("\n")                                  # an edit elsewhere: no byte-exact copy
        self.assertEqual(self.cli("uninstall").returncode, 0)
        with open(self.settings) as stream:
            self.assertEqual(json.load(stream), {"model": "opus"})

    def test_uninstall_leaves_a_status_line_someone_changed(self):
        self.cli("install")
        with open(self.settings) as stream:
            data = json.load(stream)
        data["statusLine"]["command"] = "mine.sh"
        with open(self.settings, "w") as stream:
            json.dump(data, stream)
        done = self.cli("uninstall")
        self.assertEqual(done.returncode, 2)
        with open(self.settings) as stream:
            self.assertEqual(json.load(stream)["statusLine"]["command"], "mine.sh")

    def test_dry_run_writes_nothing(self):
        self.cli("install", "--dry-run")
        self.assertFalse(os.path.exists(self.settings))


if __name__ == "__main__":
    unittest.main(verbosity=1)
