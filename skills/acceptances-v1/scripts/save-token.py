#!/usr/bin/env python3
"""Human-only hidden token input. Never print the secret or pass it as an argument."""
import getpass
import os
from pathlib import Path
import re
import sys


def main():
    if len(sys.argv) != 2 or not sys.stdin.isatty():
        raise ValueError("在自己的交互终端运行：python3 save-token.py <仓库外绝对文件路径>")
    path = Path(sys.argv[1])
    if not path.is_absolute() or path.exists():
        raise ValueError("需要新的仓库外绝对文件路径，已有文件不会覆盖")
    secret = getpass.getpass("粘贴 Web 创建的 Agent token（输入不显示）: ")
    if not re.fullmatch(r"acp_[0-9a-f-]{36}\.[A-Za-z0-9_-]+", secret):
        raise ValueError("token 格式无效")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(secret + "\n")
    print("token 已保存。将文件路径交给 agent，不要提供秘密内容。")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
