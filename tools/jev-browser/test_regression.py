"""Offline regression-runner checks; browser and worker calls are controlled fixtures."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import check_regression as runner
from regression_fixture import fixture_task


def result_for(task):
    return {
        "outcome": "verified",
        "kept_open": False,
        "page": {"url": task["expect"]["url"], "text": "\n".join(task["expect"]["text"])},
        "actions": [
            {**rule, "action": rule["label"], "outcome": "executed"}
            for rule in task["path"]["required"]
        ],
    }


class RegressionTests(unittest.TestCase):
    def test_linear_percentiles_keep_failed_samples_and_missing_counters(self):
        self.assertEqual(
            runner.describe([1, 2, 100, None]), {"samples": 3, "missing": 1, "p50": 2, "p95": 90.2}
        )
        rows = [
            {
                "arm": "baseline",
                "passed": True,
                "wall_seconds": 1,
                "actions": 1,
                "executed_actions": 1,
                "cdp_calls": 5,
            },
            {
                "arm": "candidate",
                "passed": False,
                "wall_seconds": 20,
                "actions": None,
                "executed_actions": None,
                "cdp_calls": None,
            },
        ]
        for row in rows:
            row["checks"] = {"strict_path": row["passed"], "independent_result": row["passed"]}
        summary = runner.summarize(rows, 1, True, True, True)
        self.assertFalse(summary["performance_comparable"])
        self.assertIsNone(summary["wall_p50_change_percent"])
        self.assertEqual(summary["arms"]["candidate"]["wall_seconds"]["p50"], 20)
        rows[1].update(passed=True, actions=1, executed_actions=1, cdp_calls=4)
        self.assertTrue(runner.summarize(rows, 1, True, True, True)["performance_comparable"])
        self.assertFalse(runner.summarize(rows, 1, True, True, False)["performance_comparable"])
        self.assertFalse(runner.summarize(rows, 1, True, False, True)["passed"])

    def test_correct_final_page_does_not_override_sidebar_deviation(self):
        task = fixture_task("http://127.0.0.1:3210/")
        result = result_for(task)
        result["actions"].append({"kind": "click", "action": "侧栏筛选", "outcome": "executed"})
        with tempfile.TemporaryDirectory() as directory:
            sample = Path(directory)
            (sample / "execution").mkdir()
            (sample / "execution/final.jpg").write_bytes(b"\xff\xd8\xfftest\xff\xd9")
            audit = runner.audit(result, task, sample, 0)
            self.assertTrue(audit["checks"]["independent_result"])
            self.assertFalse(audit["checks"]["strict_path"])
            self.assertFalse(audit["passed"])

    def test_freeze_copies_runtime_and_lock_without_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            source.mkdir()
            for name in (
                "jev_browser.py",
                "chrome.py",
                "path_contract.py",
                "uv.lock",
                "pyproject.toml",
                ".env.private",
            ):
                (source / name).write_text("fixture\n")
            destination = Path(directory) / "frozen"
            frozen = runner.freeze(source, destination)
            self.assertNotIn(".env.private", frozen)
            self.assertEqual(len(frozen), 5)
            (source / "jev_browser.py").write_text("changed\n")
            self.assertEqual(runner.hashes(destination), frozen)
            self.assertNotEqual(runner.hashes(source), frozen)
            (source / "shortcut.py").symlink_to(source / ".env.private")
            with self.assertRaisesRegex(ValueError, "符号链接"):
                runner.freeze(source, Path(directory) / "rejected")

    def test_scripted_selector_uses_current_unique_control_and_explicit_value(self):
        task = fixture_task("http://127.0.0.1:3210/")
        current = {
            "url": task["url"],
            "actions": [{"id": "new", "kind": "fill", "label": "搜索合成条目"}],
        }
        self.assertEqual(runner.scripted_choice(current, [], task)["choice"], "new")
        current["actions"] *= 2
        self.assertEqual(runner.scripted_choice(current, [], task)["choice"], "BLOCKED")
        self.assertEqual(
            runner.scripted_choice(current, result_for(task)["actions"], task)["choice"], "DONE"
        )

    def test_runner_preserves_failures_order_and_safety_gate(self):
        for failure in (None, "path", "model", "missing", "timeout", "safety", "drift"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                folder = Path(directory)
                candidate, baseline = folder / "current", folder / "old"
                for source in (candidate, baseline):
                    source.mkdir()
                    for name in ("jev_browser.py", "chrome.py", "check_regression.py"):
                        (source / name).write_text(source.name)
                task = fixture_task("http://127.0.0.1:3210/")
                task_file, output = folder / "task.json", folder / "output"
                runner.write_json(task_file, task)
                calls = []

                def run(arguments, **_kwargs):
                    if "--worker" not in arguments:
                        safety = output / "safety"
                        safety.mkdir()
                        runner.write_json(
                            safety / "result.json",
                            {"outcome": "verified", "checks": {"no_input": failure != "safety"}},
                        )
                        return subprocess.CompletedProcess(arguments, 0)
                    source, sample = Path(arguments[4]), Path(arguments[6])
                    arm = source.name
                    calls.append(arm)
                    if failure == "timeout":
                        raise subprocess.TimeoutExpired(arguments, 1)
                    if failure == "missing":
                        return subprocess.CompletedProcess(arguments, 2)
                    result = result_for(task)
                    if failure == "path" and arm == "baseline":
                        result["actions"].append(
                            {"kind": "click", "action": "侧栏筛选", "outcome": "executed"}
                        )
                    if failure == "model" and arm == "baseline":
                        result.update(outcome="failed", reason="jev_invalid_response")
                    execution = sample / "execution"
                    execution.mkdir()
                    runner.write_json(execution / "result.json", result)
                    (execution / "final.jpg").write_bytes(b"\xff\xd8\xfftest\xff\xd9")
                    runner.write_json(sample / "protocol.json", {"cdp_calls": 12})
                    if failure == "drift":
                        (output / "candidate/chrome.py").write_text("changed")
                    return subprocess.CompletedProcess(arguments, 0)

                with (
                    patch("builtins.print"),
                    patch.object(runner, "HERE", candidate),
                    patch.object(runner.launch, "project_environment", return_value={}),
                    patch.object(runner, "dependencies", return_value={"fixture": "1"}),
                    patch.object(runner.subprocess, "run", side_effect=run),
                ):
                    code = runner.regression(task_file, baseline, output, 2, 1120, 780, False)
                summary = json.loads((output / "summary.json").read_text())
                self.assertEqual(code, 0 if failure is None else 2)
                self.assertEqual(summary["passed"], failure is None)
                if failure == "safety":
                    self.assertEqual(calls, [])
                elif failure in {"missing", "timeout"}:
                    rows = json.loads((output / "samples.json").read_text())
                    self.assertEqual(len(rows), 1)
                    self.assertIsNone(rows[0]["cdp_calls"])
                    self.assertIsNotNone(rows[0]["wall_seconds"])
                else:
                    self.assertEqual(calls, ["baseline", "candidate", "candidate", "baseline"])
                    rows = json.loads((output / "samples.json").read_text())
                    self.assertEqual(len(rows), 4)
                    self.assertEqual(summary["arms"]["baseline"]["wall_seconds"]["samples"], 2)
                manifest = json.loads((output / "manifest.json").read_text())
                self.assertEqual(manifest["mode"], "scripted")
                self.assertEqual(manifest["viewport"], {"width": 1120, "height": 780})


if __name__ == "__main__":
    unittest.main()
