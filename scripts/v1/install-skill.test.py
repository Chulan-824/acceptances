#!/usr/bin/env python3
"""Exercise the installed skill's CLI from an unrelated business directory."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class InstallSkill(unittest.TestCase):
    def test_standalone_install_and_explicit_replace(self):
        with tempfile.TemporaryDirectory(prefix="acceptances-installer-test-") as tmp:
            base = Path(tmp)
            cli = base / "built-cli"
            subprocess.run(
                ["go", "build", "-o", str(cli), "./cmd/acceptances"],
                cwd=ROOT,
                check=True,
            )
            codex_home = base / "codex"
            destination = codex_home / "skills" / "Acceptances-Cl"
            install_env = {**os.environ, "CODEX_HOME": str(codex_home)}
            binary_dir = base / "bin"
            command = [
                "python3",
                str(ROOT / "scripts/v1/install-skill.py"),
                "--cli",
                str(cli),
                "--bin-dir",
                str(binary_dir),
            ]
            installed = subprocess.run(
                command, env=install_env, check=True, capture_output=True, text=True
            )
            self.assertEqual(json.loads(installed.stdout)["skill"], str(destination))
            self.assertIn("name: Acceptances-Cl\n", (destination / "SKILL.md").read_text())
            business = base / "business"
            business.mkdir()
            for binary in (binary_dir / "acceptances", destination / "bin/acceptances"):
                result = subprocess.run(
                    [str(binary), "context"],
                    cwd=business,
                    capture_output=True,
                    text=True,
                    check=True,
                )
                self.assertEqual(json.loads(result.stdout)["version"]["commit"], "unknown")
            self.assertNotEqual(
                subprocess.run(command, env=install_env, capture_output=True).returncode, 0
            )
            subprocess.run(
                command + ["--replace", "--destination", str(destination)],
                env=install_env,
                check=True,
                capture_output=True,
            )
            self.assertTrue((destination / "references/report.md").is_file())
            self.assertFalse((destination / "installation.json").exists())
            self.assertTrue((destination / "references/jev-browser.md").is_file())
            helper = destination / "scripts/jev-probe.py"
            hint = destination / "scripts/jev-runtime.json"
            self.assertEqual(json.loads(hint.read_text()), {"root": str(ROOT)})
            runtime = base / "optional-runtime"
            launcher = runtime / "tools/jev-browser/launch.py"
            launcher.parent.mkdir(parents=True)
            launcher.write_text(
                "import json, sys\n"
                "assert sys.argv[1:] == ['doctor']\n"
                "print(json.dumps({'api_key_configured': True, "
                "'dependencies': {'jev': 'fixture'}}))\n"
            )
            env = {**os.environ, "ACCEPTANCES_JEV_ROOT": str(runtime)}
            selected = subprocess.run(
                ["python3", str(helper), "--url", "http://localhost:5173/"],
                cwd=business,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(json.loads(selected.stdout)["executor"], "jev")
            hint.write_text(json.dumps({"root": str(base / "removed-source")}))
            env.pop("ACCEPTANCES_JEV_ROOT")
            fallback = subprocess.run(
                ["python3", str(helper), "--url", "http://localhost:5173/"],
                cwd=business,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(json.loads(fallback.stdout)["executor"], "original")
            # Losing the optional checkout does not prevent the installed CLI from running.
            subprocess.run(
                [str(binary_dir / "acceptances"), "context"],
                cwd=business,
                check=True,
                capture_output=True,
            )


if __name__ == "__main__":
    unittest.main()
