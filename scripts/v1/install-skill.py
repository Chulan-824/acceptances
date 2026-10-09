#!/usr/bin/env python3
"""Install only the V1 skill; leave legacy skills and business repositories untouched."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--destination", type=Path)
parser.add_argument("--node", type=Path)
args = parser.parse_args()
node = str(args.node) if args.node else shutil.which("node")
if not node:
    raise SystemExit("需要 Node >=22，请配置 Node 或指定 --node <绝对路径>")
version = subprocess.check_output([node, "--version"], text=True).strip()
if int(version.lstrip("v").split(".")[0]) < 22:
    raise SystemExit("需要 Node >=22，请配置 Node 或指定 --node <绝对路径>")
node = str(Path(node).resolve())
root = Path(__file__).resolve().parents[2]
source = root / "skills" / "acceptances-v1"
destination = args.destination or Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "skills" / "acceptances-v1"
destination = destination.absolute()
if destination.exists():
    raise SystemExit("目标 skill 已存在；请核对后显式更新，不覆盖已有内容")
destination.parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix="acceptances-skill-", dir=destination.parent) as temp:
    staged = Path(temp) / "acceptances-v1"
    shutil.copytree(source, staged, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.test.mjs"))
    (staged / "installation.json").write_text(json.dumps({"acceptancesRoot": str(root), "nodeExecutable": node}, indent=2) + "\n")
    staged.rename(destination)
print(json.dumps({"installed": str(destination), "acceptancesRoot": str(root)}, ensure_ascii=False))
