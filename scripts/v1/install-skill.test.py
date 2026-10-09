#!/usr/bin/env python3
"""Exercise the installed skill's CLI from an unrelated business directory."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class InstallSkill(unittest.TestCase):
    def test_standalone_install_and_explicit_replace(self):
        with tempfile.TemporaryDirectory(prefix="acceptances-installer-test-") as tmp:
            base = Path(tmp)
            cli = base / "built-cli"
            subprocess.run(["go", "build", "-o", str(cli), "./cmd/acceptances"], cwd=ROOT, check=True)
            destination = base / "skill"
            binary_dir = base / "bin"
            command = ["python3", str(ROOT / "scripts/v1/install-skill.py"), "--cli", str(cli), "--destination", str(destination), "--bin-dir", str(binary_dir)]
            installed = subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(installed.stdout)["skill"], str(destination))
            business = base / "business"
            business.mkdir()
            for binary in (binary_dir / "acceptances", destination / "bin/acceptances"):
                result = subprocess.run([str(binary), "context"], cwd=business, capture_output=True, text=True, check=True)
                self.assertEqual(json.loads(result.stdout)["version"]["commit"], "unknown")
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            subprocess.run(command + ["--replace"], check=True, capture_output=True)
            self.assertTrue((destination / "references/report.md").is_file())
            self.assertFalse((destination / "installation.json").exists())


if __name__ == "__main__":
    unittest.main()
