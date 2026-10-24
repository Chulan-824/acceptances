"""Select optional host Jev without connecting to Chrome or calling the model."""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit


def runtime_root(skill, environ):
    override = environ.get("ACCEPTANCES_JEV_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    source = skill.parent.parent
    if (source / "tools/jev-browser/launch.py").is_file():
        return source
    hint = skill / "scripts/jev-runtime.json"
    if hint.is_file():
        value = json.loads(hint.read_text())
        if isinstance(value, dict) and isinstance(value.get("root"), str) and value["root"]:
            return Path(value["root"]).expanduser().resolve()
    return None


def probe(url, skill, environ):
    result = {"executor": "original", "browser_checked": False, "model_checked": False}
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port == 0
        ):
            return {**result, "reason": "unsupported_url"}
        root = runtime_root(skill, environ)
        if root is None or not (root / "tools/jev-browser/launch.py").is_file():
            return {**result, "reason": "runtime_unavailable"}
        result["root"] = str(root)
        doctor = subprocess.run(
            [sys.executable, str(root / "tools/jev-browser/launch.py"), "doctor"],
            cwd=root,
            env=dict(environ),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        # Only expose known fields, never forward subprocess diagnostics or environment values.
        status = json.loads(doctor.stdout)
        if not isinstance(status, dict):
            return {**result, "reason": "doctor_failed"}
        if status.get("outcome") == "configuration_error":
            return {**result, "reason": "configuration_error"}
        if status.get("api_key_configured") is False:
            return {**result, "reason": "key_missing"}
        versions = status.get("dependencies")
        if isinstance(versions, dict) and versions and not all(versions.values()):
            return {**result, "reason": "dependencies_missing"}
        if (
            doctor.returncode == 0
            and status.get("api_key_configured") is True
            and isinstance(versions, dict)
            and versions
            and all(isinstance(version, str) and version for version in versions.values())
        ):
            return {**result, "executor": "jev", "reason": "configured"}
        return {**result, "reason": "doctor_failed"}
    except subprocess.TimeoutExpired:
        return {**result, "reason": "probe_timeout"}
    except (OSError, ValueError, UnicodeError):
        return {**result, "reason": "probe_failed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    result = probe(args.url, Path(__file__).resolve().parent.parent, os.environ)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
