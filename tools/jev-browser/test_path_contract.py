"""Offline path guards, including correct final pages reached by forbidden actions."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jev_browser import HandBack, load_task, run_loop, task_verification
from path_contract import verify_path
from test_jev_browser import FakeBrowser, Stale, page


class PathContractTests(unittest.TestCase):
    def task(self):
        return {
            "url": page()["url"],
            "goal": "只读打开检查项",
            "values": {},
            "allowed_write_labels": [],
            "max_steps": 3,
            "expect": {"text": ["after"]},
            "path": {"required": [{"kind": "click", "label": "打开检查项"}], "forbidden": []},
        }

    def test_validation_rejects_ambiguous_rules_and_cross_origin_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / "task.json"
            for invalid in (
                [],
                {"required": []},
                {"required": ["click"]},
                {"required": [{"kind": "click", "label": "x", "label_prefix": "x"}]},
                {"required": [{"kind": "click", "label": "x", "url": "https://example.com"}]},
                {"required": [{"kind": "click", "label": "x", "unknown": "x"}]},
                {"required": [{"kind": [], "label": "x"}]},
            ):
                with self.subTest(path=invalid):
                    file.write_text(json.dumps({**self.task(), "path": invalid}))
                    with self.assertRaises(ValueError):
                        load_task(file)

    def test_forbidden_or_out_of_order_actions_never_dispatch(self):
        for path in (
            {
                "required": [{"kind": "click", "label": "稍后"}],
                "forbidden": [{"kind": "click", "label": "打开检查项"}],
            },
            {
                "required": [
                    {"kind": "click", "label": "先做"},
                    {"kind": "click", "label": "打开检查项"},
                ]
            },
        ):
            with self.subTest(path=path):
                browser, report = FakeBrowser(), {"actions": [], "decisions": []}
                with self.assertRaisesRegex(HandBack, "path_action"):
                    run_loop(
                        browser,
                        lambda *_: {"choice": "1"},
                        Stale,
                        {**self.task(), "path": path},
                        report,
                    )
                self.assertEqual(browser.acted, 0)
                self.assertEqual(report["actions"][0]["outcome"], "path_not_executed")

    def test_done_cannot_skip_required_path_even_on_correct_final_page(self):
        task = {**self.task(), "expect": {"text": ["before"]}}
        report = {"actions": [], "decisions": []}
        run_loop(FakeBrowser(), lambda *_: {"choice": "DONE"}, Stale, task, report)
        self.assertEqual(report["outcome"], "claimed_done")
        self.assertFalse(report["verification"]["checks"]["path-required_complete"])
        self.assertEqual(len(report["decisions"]), 3)

    def test_automatic_reveal_cannot_bypass_forbidden_scroll(self):
        task = self.task()
        task["path"]["forbidden"] = [{"kind": "scroll", "label_prefix": "Reveal "}]
        report = {"actions": [], "decisions": []}
        with patch("jev_browser.reveal_action") as reveal:
            with self.assertRaisesRegex(HandBack, "path_action"):
                run_loop(FakeBrowser(stale=True), lambda *_: {"choice": "1"}, Stale, task, report)
            reveal.assert_not_called()
        self.assertEqual(
            [a["outcome"] for a in report["actions"]], ["stale_not_executed", "path_not_executed"]
        )

    def test_path_without_page_assertions_does_not_retry_impossible_done(self):
        report = {"actions": [], "decisions": []}
        run_loop(
            FakeBrowser(),
            lambda *_: {"choice": "DONE"},
            Stale,
            {**self.task(), "expect": {}},
            report,
        )
        self.assertEqual(report["outcome"], "claimed_done")
        self.assertEqual(len(report["decisions"]), 1)

    def test_path_can_require_clearing_a_field(self):
        task = self.task()
        task["path"] = {"required": [{"kind": "fill", "label": "搜索", "text": ""}]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "task.json"
            path.write_text(json.dumps(task))
            self.assertEqual(load_task(path)["path"]["required"][0]["text"], "")

    def test_valid_path_verifies_but_never_replaces_page_assertions(self):
        report, decisions = {"actions": [], "decisions": []}, iter(["1", "DONE"])
        run_loop(FakeBrowser(), lambda *_: {"choice": next(decisions)}, Stale, self.task(), report)
        self.assertEqual(report["outcome"], "verified")
        self.assertTrue(report["path_verification"]["passed"])
        self.assertFalse(
            task_verification(page(), {**self.task(), "expect": {}}, report["actions"])["passed"]
        )

    def test_audit_rejects_forbidden_sidebar_despite_correct_final_state(self):
        task = self.task()
        task["path"]["forbidden"] = [
            {"kind": "fill", "label": "搜索需求", "url": task["url"] + "detail"}
        ]
        actions = [
            {"kind": "click", "action": "打开检查项", "outcome": "executed"},
            {
                "kind": "fill",
                "action": "搜索需求",
                "url": task["url"] + "detail",
                "text": "x",
                "outcome": "executed",
            },
        ]
        self.assertFalse(task_verification(page("after"), task, actions)["passed"])
        self.assertEqual(verify_path(actions, task["path"])["forbidden_indices"], [1])
        actions[1]["outcome"] = "dispatching"
        self.assertFalse(verify_path(actions, task["path"])["passed"])
        actions[1]["outcome"] = "stale_not_executed"
        self.assertTrue(verify_path(actions, task["path"])["passed"])
        actions[0]["outcome"] = "stale_not_executed"
        self.assertFalse(verify_path(actions, task["path"])["passed"])

    def test_matching_is_scoped_and_checks_fill_value_and_order(self):
        path = {
            "required": [
                {"kind": "fill", "label_prefix": "搜索", "url": page()["url"], "text": "exact"}
            ]
        }
        action = {
            "kind": "fill",
            "action": "搜索检查项",
            "url": page()["url"],
            "text": "exact",
            "outcome": "executed",
        }
        self.assertTrue(verify_path([action], path)["passed"])
        self.assertFalse(verify_path([{**action, "text": "wrong"}], path)["passed"])
        self.assertFalse(verify_path([{**action, "url": page()["url"] + "detail"}], path)["passed"])
        self.assertFalse(verify_path([action, action], path)["passed"])


if __name__ == "__main__":
    unittest.main()
