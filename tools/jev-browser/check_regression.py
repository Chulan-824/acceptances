"""Opt-in Chrome regression: freeze safety, action paths and paired measurements."""

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import time
from contextlib import nullcontext
from datetime import UTC, datetime
from pathlib import Path

import launch
from jev_browser import MODEL, UPSTREAM, dependencies, load_task, verification
from path_contract import matches, verify_path
from regression_fixture import synthetic_task

HERE = Path(__file__).resolve().parent


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def hashes(directory):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.iterdir())
        if not path.is_symlink()
        and path.is_file()
        and (path.suffix == ".py" or path.name in {"uv.lock", "pyproject.toml"})
    }


def freeze(source, destination):
    if not (source / "jev_browser.py").is_file() or not (source / "chrome.py").is_file():
        raise ValueError("基线目录需要 jev_browser.py 和 chrome.py")
    destination.mkdir(parents=True)
    for path in sorted(source.iterdir()):
        if path.is_file() and (path.suffix == ".py" or path.name in {"uv.lock", "pyproject.toml"}):
            if path.is_symlink():
                raise ValueError("冻结源码不支持符号链接模块，未读取目标内容")
            shutil.copyfile(path, destination / path.name)
    return hashes(destination)


def scripted_choice(page, history, task):
    required = task["path"]["required"]
    index = 0
    for action in history:
        if index < len(required) and matches(action, required[index]):
            index += 1
    if index == len(required):
        return {"choice": "DONE"}
    candidates = [
        action
        for action in page["actions"]
        if matches(
            {**action, "url": page["url"], "text": task["values"].get(action["label"])},
            required[index],
        )
    ]
    return {"choice": candidates[0]["id"] if len(candidates) == 1 else "BLOCKED"}


def worker(source, task_file, output, root, mode, width, height):
    # Each arm imports only its frozen runtime modules, in a separate process.
    sys.path.insert(0, str(source))
    spec = importlib.util.spec_from_file_location("jev_browser", source / "jev_browser.py")
    executor = importlib.util.module_from_spec(spec)
    sys.modules["jev_browser"] = executor
    # The runner's validation helpers must not leak into the baseline runtime.
    sys.modules.pop("path_contract", None)
    sys.modules.pop("chrome", None)
    spec.loader.exec_module(executor)
    executor.ROOT = root
    task = executor.load_task(task_file)
    protocol = {"cdp_calls": 0, "failures": 0}
    try:
        executor.configure_harness(executor.chrome_endpoint(resolve_docker_host=True))
        from jev_ultrafast import browser, model

        original_call, original_init, original_choose = (
            browser.cdp,
            browser.Browser.__init__,
            model.choose,
        )

        def call(method, **params):
            protocol["cdp_calls"] += 1
            try:
                return original_call(method, **params)
            except BaseException:
                protocol["failures"] += 1
                raise

        def initialize(instance, *args, **kwargs):
            original_init(instance, *args, **kwargs)
            instance.call(
                "Emulation.setDeviceMetricsOverride",
                width=width,
                height=height,
                deviceScaleFactor=1,
                mobile=False,
            )

        browser.cdp, browser.Browser.__init__ = call, initialize
        if mode == "scripted":
            model.choose = lambda page, _goal, history: scripted_choice(page, history, task)
            # execute checks for a key even when its selector is replaced locally.
            os.environ["TYPESAFE_API_KEY"] = "synthetic-no-model"
        try:
            return executor.execute(task, output / "execution")
        finally:
            browser.cdp, browser.Browser.__init__, model.choose = (
                original_call,
                original_init,
                original_choose,
            )
    except Exception as error:
        write_json(output / "worker-error.json", {"reason": type(error).__name__})
        return 2
    finally:
        write_json(output / "protocol.json", protocol)


def audit(result, task, sample, returncode):
    path = verify_path(result.get("actions", []), task["path"])
    final = verification(result.get("page", {"url": "", "text": ""}), task["expect"])
    shot = sample / "execution/final.jpg"
    data = shot.read_bytes() if shot.is_file() else b""
    checks = {
        "executor_verified": returncode == 0 and result.get("outcome") == "verified",
        "independent_result": final["passed"],
        "strict_path": path["passed"],
        "jpeg": data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"),
        "cleanup": bool(result)
        and not result.get("cleanup_failed")
        and result.get("kept_open") is False,
    }
    return {"checks": checks, "passed": all(checks.values()), "path": path, "final": final}


def read_json(path):
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def describe(values):
    available = sorted(value for value in values if value is not None)
    result = {"samples": len(available), "missing": len(values) - len(available)}
    for name, fraction in (("p50", 0.5), ("p95", 0.95)):
        if not available:
            result[name] = None
            continue
        position = (len(available) - 1) * fraction
        lower = int(position)
        upper = min(lower + 1, len(available) - 1)
        result[name] = round(
            available[lower] + (available[upper] - available[lower]) * (position - lower), 6
        )
    return result


def summarize(rows, rounds, safety, unchanged, distinct):
    arms = {}
    for arm in ("baseline", "candidate"):
        samples = [row for row in rows if row["arm"] == arm]
        arms[arm] = {
            "runs": len(samples),
            "passed": sum(row["passed"] for row in samples),
            "strict_path_passed": sum(row["checks"]["strict_path"] for row in samples),
            "independent_result_passed": sum(
                row["checks"]["independent_result"] for row in samples
            ),
            **{
                metric: describe([row[metric] for row in samples])
                for metric in ("wall_seconds", "actions", "executed_actions", "cdp_calls")
            },
        }
    passed = safety and unchanged and len(rows) == rounds * 2 and all(row["passed"] for row in rows)
    comparable = passed and distinct and all(arms[arm]["cdp_calls"]["missing"] == 0 for arm in arms)
    return {
        "passed": passed,
        "safety_passed": safety,
        "frozen_inputs_unchanged": unchanged,
        "source_distinct": distinct,
        "arms": arms,
        "performance_comparable": comparable,
        "wall_p50_change_percent": round(
            (arms["candidate"]["wall_seconds"]["p50"] / arms["baseline"]["wall_seconds"]["p50"] - 1)
            * 100,
            3,
        )
        if comparable
        else None,
        "statistics": (
            "linear interpolation; all samples including failures; "
            "wall includes process startup, screenshot and cleanup; missing counters stay missing"
        ),
    }


def regression(task_file, baseline, output, rounds, width, height, official_model):
    env = launch.project_environment(dict(os.environ))
    mode = "official-model" if official_model else "scripted"
    if official_model and not env.get("TYPESAFE_API_KEY", "").strip():
        raise ValueError("官方模型对照需要项目私有配置中的 Key")
    task = load_task(task_file.resolve())
    if (
        not task.get("path", {}).get("required")
        or not verification({"url": "", "text": ""}, task.get("expect", {}))["checks"]
    ):
        raise ValueError("回归任务必须同时提供 path.required 和独立 expect 断言")
    if task["allowed_write_labels"]:
        raise ValueError("对照入口仅接受无写操作授权的任务；使用获授权的只读页面")
    output = launch.evidence_directory({**env, "JEV_EVIDENCE_DIR": str(output)})
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    write_json(output / "task.json", task)
    sources = {
        arm: freeze(source, output / arm)
        for arm, source in (("baseline", baseline), ("candidate", HERE))
    }
    manifest = {
        "task_sha256": hashlib.sha256((output / "task.json").read_bytes()).hexdigest(),
        "sources": sources,
        "upstream_commit": UPSTREAM,
        "dependencies": dependencies(),
        "python": sys.version,
        "mode": mode,
        "model": env.get("TYPESAFE_MODEL") or MODEL,
        "viewport": {"width": width, "height": height},
        "rounds": rounds,
        "order": "paired, alternate baseline/candidate first; no warmup or discarded samples",
        "started_at": datetime.now(UTC).isoformat(),
    }
    write_json(output / "manifest.json", manifest)
    env.update(PYTHONDONTWRITEBYTECODE="1", TYPESAFE_MODEL=manifest["model"])
    rows, safety = [], False
    write_json(output / "samples.json", rows)
    try:
        guard = subprocess.run(
            [
                sys.executable,
                "-B",
                str(HERE / "check_target_geometry.py"),
                "--output",
                str(output / "safety"),
                "--width",
                str(width),
                "--height",
                str(height),
            ],
            cwd=launch.ROOT,
            env=env,
            capture_output=True,
            timeout=80,
            check=False,
        )
        guard_file = output / "safety/result.json"
        guard_result = read_json(guard_file)
        safety = (
            guard.returncode == 0
            and guard_result.get("outcome") == "verified"
            and bool(guard_result.get("checks"))
            and all(guard_result["checks"].values())
        )
        if safety:
            for index in range(rounds):
                for arm in (
                    ("baseline", "candidate") if index % 2 == 0 else ("candidate", "baseline")
                ):
                    sample = output / f"{index + 1:02d}-{arm}"
                    sample.mkdir()
                    started = time.perf_counter()
                    timed_out = False
                    try:
                        process = subprocess.run(
                            [
                                sys.executable,
                                "-B",
                                str(output / "candidate/check_regression.py"),
                                "--worker",
                                str(output / arm),
                                str(output / "task.json"),
                                str(sample),
                                str(launch.ROOT),
                                mode,
                                str(width),
                                str(height),
                            ],
                            cwd=launch.ROOT,
                            env=env,
                            capture_output=True,
                            timeout=task["max_seconds"] + 40,
                            check=False,
                        )
                        code = process.returncode
                    except subprocess.TimeoutExpired:
                        code, timed_out = 124, True
                    wall = round(time.perf_counter() - started, 6)
                    result_file = sample / "execution/result.json"
                    result = read_json(result_file)
                    protocol_file = sample / "protocol.json"
                    protocol = read_json(protocol_file)
                    row = {
                        "arm": arm,
                        "round": index + 1,
                        "exit_code": code,
                        "wall_seconds": wall,
                        "outcome": result.get(
                            "outcome", "worker_timeout" if timed_out else "worker_failed"
                        ),
                        "reason": result.get("reason"),
                        "actions": len(result["actions"]) if "actions" in result else None,
                        "executed_actions": sum(
                            action["outcome"] == "executed" for action in result.get("actions", [])
                        )
                        if "actions" in result
                        else None,
                        "cdp_calls": protocol.get("cdp_calls"),
                        **audit(result, task, sample, code),
                    }
                    rows.append(row)
                    write_json(sample / "summary.json", row)
                    write_json(output / "samples.json", rows)
                    print(
                        json.dumps(
                            {
                                "arm": arm,
                                "round": index + 1,
                                "passed": row["passed"],
                                "wall_seconds": wall,
                            }
                        ),
                        flush=True,
                    )
                    if timed_out or not result or result.get("cleanup_failed"):
                        return 2
    except Exception as error:
        write_json(output / "runner-error.json", {"reason": type(error).__name__})
        return 2
    finally:
        unchanged = (
            all(hashes(output / arm) == source for arm, source in sources.items())
            and hashlib.sha256((output / "task.json").read_bytes()).hexdigest()
            == manifest["task_sha256"]
            and hashes(HERE) == sources["candidate"]
        )
        distinct = any(
            sources["baseline"].get(name) != sources["candidate"].get(name)
            for name in ("jev_browser.py", "chrome.py", "path_contract.py")
        )
        summary = summarize(rows, rounds, safety, unchanged, distinct)
        write_json(output / "summary.json", summary)
        print(json.dumps({"passed": summary["passed"], "output": str(output)}, ensure_ascii=False))
    return 0 if summary["passed"] else 2


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        source, task, output, root, mode, width, height = sys.argv[2:]
        return worker(
            Path(source), Path(task), Path(output), Path(root), mode, int(width), int(height)
        )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", type=Path, help="省略时使用临时合成页及固定路径任务")
    parser.add_argument("--baseline", type=Path, default=HERE)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--width", type=int, default=1120)
    parser.add_argument("--height", type=int, default=780)
    parser.add_argument(
        "--official-model",
        action="store_true",
        help="显式允许官方 API 调用及费用；仅在获授权的页面运行",
    )
    args = parser.parse_args()
    if (
        not 1 <= args.rounds <= 30
        or not 320 <= args.width <= 3840
        or not 240 <= args.height <= 2160
    ):
        parser.error("rounds 范围 1–30；视口宽 320–3840，高 240–2160")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    output = args.output or launch.ROOT / "artifacts/jev-browser" / (stamp + "-regression")
    with nullcontext(args.task) if args.task else synthetic_task() as task:
        return regression(
            task,
            args.baseline.resolve(),
            output,
            args.rounds,
            args.width,
            args.height,
            args.official_model,
        )


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(
            json.dumps(
                {
                    "outcome": "configuration_error",
                    "reason": str(error) if type(error) is ValueError else type(error).__name__,
                },
                ensure_ascii=False,
            )
        )
        sys.exit(2)
