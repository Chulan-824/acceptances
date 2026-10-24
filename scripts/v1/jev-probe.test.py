"""Offline selection checks using a controlled doctor; no Chrome or model calls."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "skills/acceptances-v1/scripts/jev-probe.py"
SPEC = importlib.util.spec_from_file_location("jev_probe", SCRIPT)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
URL = "http://127.0.0.1:5173/"


class JevProbeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="acceptances-jev-probe-")
        self.addCleanup(self.directory.cleanup)
        self.base = Path(self.directory.name).resolve()
        self.runtime = self.base / "source with spaces"
        self.skill = self.base / "installed-skill"
        (self.skill / "scripts").mkdir(parents=True)
        (self.runtime / "tools/jev-browser").mkdir(parents=True)
        self.environ = {**os.environ, "ACCEPTANCES_JEV_ROOT": str(self.runtime)}

    def doctor(self, status, exit_code=0, *, raw=False):
        # Only the fixture's doctor is executable; any accidental inspect/run fails.
        (self.runtime / "tools/jev-browser/launch.py").write_text(
            "import json, pathlib, sys\n"
            "assert sys.argv[1:] == ['doctor']\n"
            "pathlib.Path('doctor-called').write_text('doctor')\n"
            + (f"print({status!r})\n" if raw else f"print(json.dumps({status!r}))\n")
            + "print('private-diagnostic-sentinel', file=sys.stderr)\n"
            + f"sys.exit({exit_code})\n"
        )

    def test_configured_key_and_dependencies_select_jev_without_browser_claim(self):
        self.doctor({"api_key_configured": True, "dependencies": {"jev-ultrafast": "fixture"}})
        result = PROBE.probe(URL, self.skill, self.environ)
        self.assertEqual(result["executor"], "jev")
        self.assertEqual(result["root"], str(self.runtime))
        self.assertFalse(result["browser_checked"])
        self.assertFalse(result["model_checked"])
        self.assertTrue((self.runtime / "doctor-called").exists())

    def test_unavailable_configuration_selects_original(self):
        for status, code, reason in [
            (
                {"api_key_configured": False, "dependencies": {"jev": "fixture"}},
                2,
                "key_missing",
            ),
            (
                {"api_key_configured": True, "dependencies": {"jev": None}},
                2,
                "dependencies_missing",
            ),
            (
                {
                    "outcome": "configuration_error",
                    "reason": "private-diagnostic-sentinel",
                },
                2,
                "configuration_error",
            ),
            (
                {"api_key_configured": True, "dependencies": {"jev": "fixture"}},
                2,
                "doctor_failed",
            ),
            ({"api_key_configured": True, "dependencies": {}}, 0, "doctor_failed"),
            ([], 0, "doctor_failed"),
        ]:
            with self.subTest(reason=reason, status=status):
                self.doctor(status, code)
                result = PROBE.probe(URL, self.skill, self.environ)
                self.assertEqual(result["executor"], "original")
                self.assertEqual(result["reason"], reason)
                self.assertNotIn("private-diagnostic-sentinel", json.dumps(result))

    def test_no_runtime_or_stale_explicit_override_never_calls_doctor(self):
        self.doctor({"api_key_configured": True, "dependencies": {"jev": "fixture"}})
        (self.skill / "scripts/jev-runtime.json").write_text(
            json.dumps({"root": str(self.runtime)})
        )
        result = PROBE.probe(URL, self.skill, {"ACCEPTANCES_JEV_ROOT": str(self.base / "missing")})
        self.assertEqual(result["reason"], "runtime_unavailable")
        self.assertFalse((self.runtime / "doctor-called").exists())
        (self.skill / "scripts/jev-runtime.json").unlink()
        self.assertEqual(PROBE.probe(URL, self.skill, {})["executor"], "original")

    def test_source_skill_and_installed_hint_locate_runtime_from_foreign_directory(
        self,
    ):
        self.doctor({"api_key_configured": True, "dependencies": {"jev": "fixture"}})
        source_skill = self.runtime / "skills/acceptances-v1"
        self.assertEqual(PROBE.probe(URL, source_skill, {})["executor"], "jev")
        (self.skill / "scripts/jev-runtime.json").write_text(
            json.dumps({"root": str(self.runtime)})
        )
        self.assertEqual(PROBE.probe(URL, self.skill, {})["executor"], "jev")

    def test_remote_credentialed_and_malformed_urls_do_not_call_doctor(self):
        self.doctor({"api_key_configured": True, "dependencies": {"jev": "fixture"}})
        for url in [
            "https://localhost/",
            "http://example.com/",
            "http://user:password@localhost/",
            "http://@localhost/",
            "http://localhost:0/",
            "http://localhost:invalid/",
            "http://[/",
        ]:
            with self.subTest(url=url):
                self.assertEqual(PROBE.probe(url, self.skill, self.environ)["executor"], "original")
        self.assertFalse((self.runtime / "doctor-called").exists())

    def test_bad_hint_invalid_output_timeout_and_process_failure_fall_back(self):
        (self.skill / "scripts/jev-runtime.json").write_text("not-json")
        self.assertEqual(PROBE.probe(URL, self.skill, {})["reason"], "probe_failed")
        self.doctor("private-diagnostic-sentinel", raw=True)
        result = PROBE.probe(URL, self.skill, self.environ)
        self.assertEqual(result["executor"], "original")
        self.assertNotIn("private-diagnostic-sentinel", json.dumps(result))
        for error, reason in [
            (subprocess.TimeoutExpired("doctor", 15), "probe_timeout"),
            (OSError("private-diagnostic-sentinel"), "probe_failed"),
        ]:
            with (
                self.subTest(reason=reason),
                patch.object(PROBE.subprocess, "run", side_effect=error),
            ):
                result = PROBE.probe(URL, self.skill, self.environ)
                self.assertEqual(result["reason"], reason)
                self.assertEqual(result["executor"], "original")

    def test_cli_returns_successful_selection_without_exposing_doctor_output(self):
        self.doctor({"api_key_configured": False, "dependencies": {"jev": "fixture"}}, 2)
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--url", URL],
            cwd=self.base,
            env=self.environ,
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout)["reason"], "key_missing")
        self.assertNotIn("private-diagnostic-sentinel", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
