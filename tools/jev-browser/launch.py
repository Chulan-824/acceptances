"""Project configuration and host/Docker entry point; requires only Python 3.10+."""

import json
import os
import subprocess
import sys
from pathlib import Path

from chrome import chrome_endpoint, container_endpoint

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / ".env"
CONFIG_KEYS = {"TYPESAFE_API_KEY", "TYPESAFE_MODEL", "JEV_CHROME_CDP_URL", "JEV_EVIDENCE_DIR"}


def project_path(value):
    path = Path(value).expanduser()
    return (path if path.is_absolute() else ROOT / path).resolve()


def config_path(environ):
    return project_path(environ.get("JEV_CONFIG_FILE") or str(DEFAULT_CONFIG))


def project_environment(environ):
    result = dict(environ)
    path = config_path(result)
    if not path.exists():
        if result.get("JEV_CONFIG_FILE"):
            raise ValueError("指定的 JEV_CONFIG_FILE 不存在")
        return result
    seen = set()
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key not in CONFIG_KEYS:
            continue
        if not separator or key in seen:
            raise ValueError(f"Jev 私有配置第 {number} 行格式无效或变量不支持")
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Jev 私有配置第 {number} 行引号不匹配")
            value = value[1:-1]
        seen.add(key)
        # Exported variables, including explicitly empty ones, take precedence.
        result.setdefault(key, value)
    return result


def initialize_config(environ):
    path = config_path(environ)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise ValueError("项目环境文件已存在，未覆盖；请在本机编辑器中配置 Jev 变量") from None
    with os.fdopen(descriptor, "w") as stream:
        stream.write((ROOT / ".env.example").read_text())
    print(
        json.dumps(
            {"config_file": str(path), "next": "在本机编辑器中填写 TYPESAFE_API_KEY"},
            ensure_ascii=False,
        )
    )


def evidence_directory(environ):
    path = project_path(environ.get("JEV_EVIDENCE_DIR") or "artifacts/jev-browser")
    if path == ROOT or path in ROOT.parents or config_path(environ).is_relative_to(path):
        raise ValueError("证据目录不能是仓库根目录、其父目录或包含私有环境文件的目录")
    return path


def docker_command(arguments, environ):
    env = dict(environ)
    env["JEV_BUILD_CONTEXT"] = str(ROOT / "tools/jev-browser")
    env["JEV_TASK_FILE"] = str(ROOT / "tools/jev-browser/task.example.json")
    base = [
        "docker",
        "compose",
        "--env-file",
        os.devnull,
        "--project-name",
        "acceptances-jev",
        "--project-directory",
        str(ROOT),
        "-f",
        str(ROOT / "deploy/compose.jev.yaml"),
    ]
    if sys.platform == "linux":
        base += ["-f", str(ROOT / "deploy/compose.jev-linux.yaml")]
    base += ["--profile", "jev"]
    if arguments == ["build"]:
        return base + ["build", "jev-runner"], env
    if not arguments or arguments[0] not in {"doctor", "inspect", "run"}:
        raise ValueError("docker 子命令支持 build、doctor、inspect URL、run TASK")
    command = arguments[0]
    if len(arguments) != (1 if command == "doctor" else 2):
        raise ValueError("Docker 执行需要一个 URL 或任务文件；doctor 无额外参数")
    if command == "run" and not env.get("TYPESAFE_API_KEY", "").strip():
        raise ValueError("请在项目私有配置或进程环境中设置 TYPESAFE_API_KEY")
    if command != "doctor":
        env["JEV_CHROME_CDP_URL"] = container_endpoint(chrome_endpoint(env))
    evidence = evidence_directory(env)
    evidence.mkdir(parents=True, exist_ok=True)
    env["JEV_EVIDENCE_DIR"] = str(evidence)
    env["JEV_UID"] = str(os.getuid())
    env["JEV_GID"] = str(os.getgid())
    container_arguments = list(arguments)
    if command == "run":
        task = project_path(arguments[1])
        if (
            not task.is_file()
            or task.suffix.lower() != ".json"
            or task == config_path(env)
            or any(part.startswith(".env") for part in task.parts)
        ):
            raise ValueError("TASK 必须是存在的 JSON 任务文件，且不能是私有环境文件")
        env["JEV_TASK_FILE"] = str(task)
        container_arguments[1] = "/task.json"
    return base + ["run", "--rm", "--no-deps", "-T", "jev-runner", *container_arguments], env


def main(arguments=None):
    arguments = sys.argv[1:] if arguments is None else arguments
    if not arguments:
        raise ValueError("用法: launch.py config | doctor | inspect URL | run TASK | docker ...")
    if arguments == ["config"]:
        initialize_config(os.environ)
        return 0
    env = project_environment(os.environ)
    if arguments[0] == "docker":
        command, env = docker_command(arguments[1:], env)
    else:
        python = Path(__file__).parent / ".venv/bin/python"
        if not python.exists():
            raise ValueError("请先执行 make jev-setup；Docker 模式不需要宿主机虚拟环境")
        evidence = evidence_directory(env)
        env["JEV_OUTPUT_DIR"] = str(evidence)
        command = [str(python), str(Path(__file__).with_name("jev_browser.py")), *arguments]
    # Keys travel in the child environment, never command-line arguments.
    return subprocess.run(command, env=env, cwd=ROOT, check=False).returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, UnicodeError) as error:
        reason = str(error) if type(error) is ValueError else type(error).__name__
        print(json.dumps({"outcome": "configuration_error", "reason": reason}, ensure_ascii=False))
        sys.exit(2)
