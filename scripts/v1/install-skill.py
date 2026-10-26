#!/usr/bin/env python3
"""Install the standalone local archive CLI and self-contained agent skill."""

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path, help="skill directory")
parser.add_argument("--bin-dir", type=Path, default=Path.home() / ".local" / "bin")
parser.add_argument(
    "--cli", type=Path, help="prebuilt acceptances executable; otherwise build with Go"
)
parser.add_argument(
    "--replace",
    action="store_true",
    help="replace an existing Acceptances skill and CLI",
)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
source = root / "skills" / "Acceptances-Cl"
destination = (
    args.destination
    or Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills" / "Acceptances-Cl"
).absolute()
binary = args.bin_dir.absolute() / "acceptances"
if destination == source or source in destination.parents or destination in source.parents:
    raise SystemExit("安装目标不能覆盖源码 skill")
for target in (destination, binary):
    if target.exists() and not args.replace:
        raise SystemExit(f"{target} 已存在；使用 --replace 显式替换")
if destination.exists() and (not destination.is_dir() or destination.is_symlink()):
    raise SystemExit("skill 目标必须为普通目录")
if destination.exists() and not (destination / "SKILL.md").is_file():
    raise SystemExit("目标没有 SKILL.md；拒绝替换非 skill 目录")
with tempfile.TemporaryDirectory(prefix="acceptances-install-") as temp:
    staged = Path(temp) / "Acceptances-Cl"
    shutil.copytree(source, staged)
    # Optional Jev location hint; CLI/skill remain usable if this checkout is absent.
    (staged / "scripts" / "jev-runtime.json").write_text(
        json.dumps({"root": str(root)}, ensure_ascii=False) + "\n"
    )
    # Keep the scope, provenance and third-party terms with the installed CLI/skill.
    licensing = staged / "licensing"
    licensing.mkdir()
    for name in ("LICENSE", "LICENSE-SCOPE.md", "NOTICE"):
        shutil.copy2(root / name, licensing / name)
    shutil.copytree(root / "LICENSES", licensing / "LICENSES")
    shutil.copytree(root / "docs/licensing", licensing / "docs/licensing")
    (staged / "bin").mkdir(exist_ok=True)
    executable = staged / "bin" / "acceptances"
    if args.cli:
        shutil.copy2(args.cli, executable)
    else:
        subprocess.run(
            ["go", "build", "-o", str(executable), "./cmd/acceptances"],
            cwd=root,
            check=True,
        )
    executable.chmod(0o755)
    subprocess.run([str(executable), "version"], check=True, stdout=subprocess.DEVNULL)
    destination.parent.mkdir(parents=True, exist_ok=True)
    binary.parent.mkdir(parents=True, exist_ok=True)
    # All compilation and validation finish before replacing installed files.
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(staged, destination)
    shutil.copy2(executable, binary)
print(
    json.dumps(
        {
            "skill": str(destination),
            "cli": str(binary),
            "licensing": str(destination / "licensing"),
        },
        ensure_ascii=False,
    )
)
