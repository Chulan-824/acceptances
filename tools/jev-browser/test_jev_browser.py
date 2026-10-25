"""Offline behavior checks: no Chrome, network, or model calls."""

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from jev_browser import (
    HandBack,
    action_text,
    browser_session,
    chrome_endpoint,
    configure_harness,
    deadline,
    execute,
    failure_reason,
    load_task,
    measure,
    model_context,
    observe_ready,
    replacement_action,
    run_loop,
    stage,
    verification,
)


def page(text="before"):
    return {
        "url": "http://127.0.0.1:5173/",
        "title": "fixture",
        "text": text,
        "fingerprint": text,
        "marker": text,
        "scroll": {"y": 0, "height": 1000},
        "readiness": {"login": False, "busy": False},
        "actions": [{"id": "1", "label": "打开检查项", "kind": "click"}],
    }


class Stale(Exception):
    pass


def upstream_browser():
    with patch.dict("os.environ", {}, clear=True):
        configure_harness()
        from jev_ultrafast import browser

    return browser


class FakeBrowser:
    def __init__(self, *, fail_after_action=False, stale=False):
        self.acted = 0
        self.fail_after_action = fail_after_action
        self.stale = stale

    def observe(self, screenshot=False):
        if self.acted and self.fail_after_action:
            raise RuntimeError("post-action observation failed")
        return page("after" if self.acted else "before")

    def evaluate(self, _expression):
        return {"login": False, "busy": False}

    def fresh(self, current):
        return True

    def act(self, action, current, text=None):
        if self.stale:
            raise Stale()
        self.acted += 1


class JevBrowserTests(unittest.TestCase):
    def task(self):
        return {
            "url": "http://127.0.0.1:5173/",
            "goal": "打开检查项",
            "values": {},
            "allowed_write_labels": [],
            "max_steps": 3,
            "expect": {"text": ["after"]},
        }

    def decision(self, choice):
        return {
            "choice": choice,
            "operation": "DONE" if choice == "DONE" else "CLICK",
            "confidence": 1,
            "model": "fixture",
            "usage": {},
        }

    def test_task_rejects_remote_origin_and_invalid_budget(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "task.json"
            task = self.task()
            for changes in [
                {"url": "https://example.com"},
                {"url": "http://name:password@localhost:5173/"},
                {"max_steps": True},
                {"max_seconds": 301},
                {"timeouts": {"navigation": True}},
                {"timeouts": {"login": 61}},
                {"timeouts": {"unknown": 2}},
                {"ready": {}},
                {"ready": {"text": "after"}},
                {"ready": {"url": "https://example.com/"}},
                {"expect": {"text": "after"}},
            ]:
                with self.subTest(changes=changes):
                    path.write_text(json.dumps({**task, **changes}))
                    with self.assertRaises(ValueError):
                        load_task(path)

    def test_nested_deadlines_preserve_total_budget_and_reason(self):
        started = time.monotonic()
        with self.assertRaisesRegex(HandBack, "time_budget_exhausted"):
            with deadline(0.06):
                with deadline(0.2, "navigation_timeout"):
                    time.sleep(0.15)
        self.assertLess(time.monotonic() - started, 0.14)
        with self.assertRaisesRegex(HandBack, "login_timeout"):
            with deadline(1):
                with deadline(0.01, "login_timeout"):
                    time.sleep(0.05)

    def test_readiness_waits_for_actual_text_not_stable_empty_shell(self):
        browser = FakeBrowser()
        observations = iter([page("loading"), page("loading"), page("rows ready")])
        browser.observe = lambda **_: next(observations, page("rows ready"))
        browser.evaluate = lambda _: {"login": False, "busy": False}
        task = {**self.task(), "ready": {"text": ["rows ready"]}}
        report = {}
        self.assertIn("rows ready", observe_ready(browser, task, report, initial=True)["text"])
        self.assertEqual(report["timings"][-1]["stage"], "data_ready")
        self.assertEqual(browser.acted, 0)

    def test_geometry_changes_do_not_reset_semantic_stability(self):
        browser = FakeBrowser()
        clock = [0.0]
        samples = []

        def observe(**_):
            current = page()
            current["fingerprint"] = str(clock[0])
            samples.append(current)
            return current

        browser.observe = observe
        with (
            patch("jev_browser.time.monotonic", side_effect=lambda: clock[0]),
            patch(
                "jev_browser.time.sleep", side_effect=lambda s: clock.__setitem__(0, clock[0] + s)
            ),
        ):
            report = {}
            current = observe_ready(browser, self.task(), report)
        self.assertGreaterEqual(clock[0], 0.15)
        self.assertLess(clock[0], 0.21)
        self.assertEqual(current, samples[-1])
        self.assertEqual(report["performance"]["snapshot"]["count"], len(samples))

    def test_semantic_scroll_and_loading_changes_restart_stability(self):
        for key, value in (
            ("marker", "new field value or control identity"),
            ("scroll", {"y": 10, "height": 1100}),
            ("readiness", {"login": False, "busy": True}),
        ):
            with self.subTest(key=key):
                browser = FakeBrowser()
                clock = [0.0]

                def observe(**_):
                    current = page()
                    if 0.05 <= clock[0] < 0.15:
                        current[key] = value
                    return current

                browser.observe = observe
                with (
                    patch("jev_browser.time.monotonic", side_effect=lambda: clock[0]),
                    patch(
                        "jev_browser.time.sleep",
                        side_effect=lambda s: clock.__setitem__(0, clock[0] + s),
                    ),
                ):
                    observe_ready(browser, self.task(), {})
                self.assertGreaterEqual(clock[0], 0.3)

    def test_snapshot_login_and_external_origin_stop_before_model(self):
        for changes, reason in (
            ({"readiness": {"login": True, "busy": False}}, "login_required"),
            ({"url": "http://localhost:9999/"}, "navigation_left_task_origin"),
        ):
            with self.subTest(reason=reason):
                browser = FakeBrowser()
                browser.observe = lambda **_: {**page(), **changes}
                with self.assertRaisesRegex(HandBack, reason):
                    run_loop(
                        browser,
                        lambda *_: self.fail("must not call model"),
                        Stale,
                        self.task(),
                        {"actions": [], "decisions": []},
                    )
                self.assertEqual(browser.acted, 0)

    def test_observation_adapter_only_augments_snapshot_calls(self):
        with patch.dict("os.environ", {}, clear=True):
            configure_harness()
            from jev_ultrafast.browser import MARKER, READ_STATE

        from jev_ultrafast import browser as upstream

        report = {}
        response = {"result": {"value": {**page(), "url": "http://127.0.0.1:5173/"}}}
        with patch.object(upstream, "cdp", return_value=response) as call:
            original = upstream.cdp
            with browser_session(report) as (observed, _):
                state = upstream.browser_operation(
                    {"operation": "observe", "session": "test", "screenshot": False}
                )
                self.assertIn("fingerprint", state)
                expression = call.call_args.kwargs["expression"]
                self.assertIn(READ_STATE, expression)
                self.assertIn("page.readiness=", expression)
                instance = observed.__new__(observed)
                instance.session = "test"
                instance.call("Runtime.evaluate", expression=MARKER, returnByValue=True)
                self.assertEqual(call.call_args.kwargs["expression"], MARKER)
                instance.call("Input.dispatchMouseEvent", type="mousePressed", x=1, y=2)
                self.assertEqual(
                    call.call_args.kwargs,
                    {"session_id": "test", "type": "mousePressed", "x": 1, "y": 2},
                )
            self.assertIs(upstream.cdp, original)
            with self.assertRaises(RuntimeError):
                with browser_session(report):
                    raise RuntimeError("interrupted")
            self.assertIs(upstream.cdp, original)
        self.assertEqual(report["performance"]["cdp.Runtime.evaluate"]["count"], 2)

    def test_measurements_preserve_failures_and_elapsed_time(self):
        report = {}
        with patch("jev_browser.time.perf_counter", side_effect=[1, 1.25, 2, 2.5]):
            with measure(report, "snapshot"):
                pass
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                with measure(report, "snapshot"):
                    raise RuntimeError("interrupted")
        self.assertEqual(
            report["performance"]["snapshot"], {"count": 2, "elapsed_seconds": 0.75, "failures": 1}
        )

    def test_target_geometry_precedes_every_targeted_input(self):
        upstream = upstream_browser()

        for kind in ("click", "fill", "select"):
            with self.subTest(kind=kind), patch.object(upstream, "cdp") as protocol:
                protocol.return_value = {"result": {"value": True}}
                report = {}
                with browser_session(report) as (Browser, _):
                    browser = Browser.__new__(Browser)
                    browser.session = "test"
                    action = {"kind": kind, "node": 7}

                    def act(instance, selected, current, text=None):
                        self.assertIs(instance, browser)
                        self.assertIs(selected, action)
                        self.assertEqual(current, page())
                        self.assertEqual(text, "explicit")
                        self.assertEqual(protocol.call_count, 1)
                        self.assertTrue(protocol.call_args.kwargs["awaitPromise"])
                        self.assertTrue(protocol.call_args.kwargs["expression"].endswith("(7)"))
                        return {"executed": "test"}

                    with patch.object(upstream.Browser, "act", act):
                        self.assertEqual(
                            browser.act(action, page(), text="explicit"), {"executed": "test"}
                        )
                self.assertEqual(report["performance"]["target_geometry"]["failures"], 0)

    def test_unconfirmed_geometry_never_delegates_input(self):
        upstream = upstream_browser()

        for response in (
            {"result": {"value": False}},
            {"result": {"value": 1}},
            {},
            {"exceptionDetails": {"text": "context destroyed"}},
        ):
            with (
                self.subTest(response=response),
                patch.object(upstream, "cdp", return_value=response),
                patch.object(upstream.Browser, "act") as act,
                browser_session({}) as (Browser, StalePage),
            ):
                browser = Browser.__new__(Browser)
                browser.session = "test"
                with self.assertRaises(StalePage):
                    browser.act({"kind": "click", "node": 7}, page())
                act.assert_not_called()

    def test_geometry_preserves_deadline_and_rejects_non_integer_nodes(self):
        upstream = upstream_browser()

        with (
            patch.object(upstream, "cdp", side_effect=lambda *_a, **_k: time.sleep(0.1)) as call,
            patch.object(upstream.Browser, "act") as act,
            browser_session({}) as (Browser, _),
        ):
            browser = Browser.__new__(Browser)
            browser.session = "test"
            for node in (True, "7", None):
                with self.subTest(node=node), self.assertRaises(ValueError):
                    browser.act({"kind": "click", "node": node}, page())
            call.assert_not_called()
            with self.assertRaisesRegex(HandBack, "navigation_timeout"):
                with deadline(0.01, "navigation_timeout"):
                    browser.act({"kind": "click", "node": 7}, page())
            act.assert_not_called()

    def test_wait_and_scroll_keep_original_action_path(self):
        upstream = upstream_browser()

        with (
            patch.object(upstream, "cdp") as protocol,
            patch.object(upstream.Browser, "act", return_value={"executed": "test"}) as act,
            browser_session({}) as (Browser, _),
        ):
            browser = Browser.__new__(Browser)
            for kind in ("wait", "scroll"):
                action = {"kind": kind}
                self.assertEqual(browser.act(action, page()), {"executed": "test"})
                act.assert_called_with(action, page(), text=None)
            protocol.assert_not_called()

    def test_login_and_data_timeouts_do_not_call_model_or_dispatch(self):
        for kind in ["login", "data_ready"]:
            browser = FakeBrowser()
            browser.evaluate = lambda _, k=kind: {"login": k == "login", "busy": k == "data_ready"}
            browser.observe = lambda **_: {**page(), "readiness": {"login": False, "busy": True}}
            task = {**self.task(), "timeouts": {kind: 0.02}}
            report = {"actions": [], "decisions": []}
            with self.subTest(stage=kind), self.assertRaisesRegex(HandBack, kind + "_timeout"):
                run_loop(
                    browser, lambda *_: self.fail("model must not be called"), Stale, task, report
                )
            self.assertEqual(browser.acted, 0)
            self.assertEqual(report["timings"][-1]["outcome"], "interrupted")

    def test_navigation_timeout_preserves_unknown_write_outcome(self):
        browser = FakeBrowser()
        browser.act = lambda *_args, **_kwargs: time.sleep(0.1)
        report = {"actions": [], "decisions": []}
        task = {**self.task(), "timeouts": {"navigation": 0.01}}
        with self.assertRaisesRegex(HandBack, "navigation_timeout"):
            run_loop(browser, lambda *_: self.decision("1"), Stale, task, report)
        self.assertEqual(len(report["actions"]), 1)
        self.assertEqual(report["actions"][0]["outcome"], "dispatching")

    def test_completed_stage_does_not_reset_total_budget(self):
        report = {}
        with self.assertRaisesRegex(HandBack, "time_budget_exhausted"):
            with deadline(0.06):
                with stage(report, "navigation", 1):
                    time.sleep(0.03)
                with stage(report, "data_ready", 1):
                    time.sleep(0.05)
        self.assertEqual([x["stage"] for x in report["timings"]], ["navigation", "data_ready"])

    def test_explicit_input_and_mutation_labels(self):
        task = self.task()
        fill = {"kind": "fill", "label": "搜索"}
        with self.assertRaisesRegex(HandBack, "text_value_missing"):
            action_text(fill, task)
        task["values"]["搜索"] = "指定文本"
        self.assertEqual(action_text(fill, task), "指定文本")
        delete = {"kind": "click", "label": "删除项目"}
        with self.assertRaisesRegex(HandBack, "write_action"):
            action_text(delete, task)
        task["allowed_write_labels"] = ["删除项目"]
        self.assertIsNone(action_text(delete, task))

    def test_done_does_not_override_expectations(self):
        for expect in [{}, {"text": ["missing"]}]:
            task = {**self.task(), "expect": expect}
            report = {"actions": [], "decisions": []}
            run_loop(FakeBrowser(), lambda *_: self.decision("DONE"), Stale, task, report)
            self.assertEqual(report["outcome"], "claimed_done")

    def test_last_allowed_action_can_be_verified(self):
        report = {"actions": [], "decisions": []}
        choices = iter(["1", "DONE"])
        task = {**self.task(), "max_steps": 1}
        run_loop(FakeBrowser(), lambda *_: self.decision(next(choices)), Stale, task, report)
        self.assertEqual(report["outcome"], "verified")

    def test_missing_key_stops_before_harness_setup(self):
        with (
            patch.dict("os.environ", {}, clear=True),
            patch("jev_browser.configure_harness") as setup,
        ):
            with self.assertRaisesRegex(ValueError, "TYPESAFE_API_KEY"):
                execute(self.task(), Path("unused"))
            setup.assert_not_called()

    def test_env_autoload_path_is_rejected_without_reading(self):
        with (
            patch("jev_browser.Path.exists", return_value=True),
            patch.object(Path, "read_text", side_effect=AssertionError("must not read")),
        ):
            with self.assertRaisesRegex(ValueError, "未读取"):
                configure_harness()

    def test_task_rejects_env_file_and_non_object(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env.task"
            with self.assertRaisesRegex(ValueError, "不能读取"):
                load_task(env)
            path = Path(directory) / "task.json"
            for invalid in ([], {"goal": "x"}, {"url": 42}):
                path.write_text(json.dumps(invalid))
                with self.assertRaises(ValueError):
                    load_task(path)

    def test_real_outcome_checked_after_action(self):
        report = {"actions": [], "decisions": []}
        choices = iter(["1", "DONE"])
        run_loop(FakeBrowser(), lambda *_: self.decision(next(choices)), Stale, self.task(), report)
        self.assertEqual(report["outcome"], "verified")
        self.assertEqual(report["actions"][0]["outcome"], "executed")

    def test_observation_failure_keeps_executed_action(self):
        report = {"actions": [], "decisions": []}
        with self.assertRaises(RuntimeError):
            run_loop(
                FakeBrowser(fail_after_action=True),
                lambda *_: self.decision("1"),
                Stale,
                self.task(),
                report,
            )
        self.assertEqual(report["actions"][0]["outcome"], "executed")

    def test_uncertain_dispatch_is_not_retried(self):
        class InterruptedBrowser(FakeBrowser):
            def act(self, action, current, text=None):
                self.acted += 1
                raise RuntimeError("input interrupted; execution unknown")

        browser = InterruptedBrowser()
        report = {"actions": [], "decisions": []}
        with self.assertRaises(RuntimeError):
            run_loop(browser, lambda *_: self.decision("1"), Stale, self.task(), report)
        self.assertEqual(browser.acted, 1)
        self.assertEqual(report["actions"][0]["outcome"], "dispatching")

    def test_spa_loading_snapshot_settles_before_decision(self):
        class LoadingBrowser(FakeBrowser):
            observations = 0

            def observe(self, screenshot=False):
                self.observations += 1
                return page("loading" if self.observations < 3 else "after")

        def choose(current, _goal, _history):
            self.assertEqual(current["text"], "after")
            return self.decision("DONE")

        report = {"actions": [], "decisions": []}
        run_loop(LoadingBrowser(), choose, Stale, self.task(), report)
        self.assertEqual(report["outcome"], "verified")

    def test_stale_action_rebinds_before_model_can_claim_it_completed(self):
        class RemountingBrowser(FakeBrowser):
            remounted = False

            def observe(self, screenshot=False):
                current = super().observe(screenshot)
                if self.remounted:
                    current["actions"][0]["id"] = "replacement"
                return current

            def act(self, action, current, text=None):
                if not self.remounted:
                    self.remounted = True
                    raise Stale()
                if action["id"] != "replacement":
                    raise AssertionError("must use the newly observed control")
                super().act(action, current, text)

        browser = RemountingBrowser()
        report = {"actions": [], "decisions": []}

        # Reproduces upstream's lossy recent_actions: a failed attempt looks completed.
        def choose(_page, _goal, history):
            return self.decision("DONE" if history else "1")

        run_loop(browser, choose, Stale, self.task(), report)
        self.assertEqual(report["outcome"], "verified")
        self.assertEqual(browser.acted, 1)
        self.assertEqual(
            [action["outcome"] for action in report["actions"]],
            ["stale_not_executed", "executed"],
        )

    def test_repeated_stale_action_stops_after_three_attempts(self):
        report = {"actions": [], "decisions": []}
        with self.assertRaisesRegex(HandBack, "stale_retry_exhausted"):
            run_loop(
                FakeBrowser(stale=True),
                lambda *_: self.decision("1"),
                Stale,
                self.task(),
                report,
            )
        self.assertTrue(all(x["outcome"] == "stale_not_executed" for x in report["actions"]))
        self.assertEqual(len(report["actions"]), 3)
        self.assertEqual(len(report["decisions"]), 1)

    def test_unexecuted_actions_are_feedback_not_completed_history(self):
        success = {"action": "成功", "kind": "click", "outcome": "executed"}
        stale = {"action": "未执行", "kind": "fill", "outcome": "stale_not_executed"}
        goal, history = model_context(self.task(), {"actions": [success, stale]}, page())
        self.assertEqual(history, [success])
        self.assertIn('"outcome": "stale_not_executed"', goal)
        self.assertNotIn("previous DONE", goal)

    def test_rebind_requires_same_url_and_unique_unchanged_control(self):
        current = page()
        previous = current["actions"][0].copy()
        self.assertIsNotNone(replacement_action(current, previous, current["url"]))
        self.assertIsNone(replacement_action(current, previous, current["url"] + "other"))
        current["actions"].append({**previous, "id": "other"})
        self.assertIsNone(replacement_action(current, previous, current["url"]))
        current["actions"] = [{**previous, "value": "already changed"}]
        self.assertIsNone(replacement_action(current, previous, current["url"]))

    def test_failed_done_can_recover_and_repeated_false_done_is_bounded(self):
        report = {"actions": [], "decisions": []}
        choices = iter(["DONE", "1", "DONE"])
        goals = []

        def choose(_page, goal, _history):
            goals.append(goal)
            return self.decision(next(choices))

        run_loop(FakeBrowser(), choose, Stale, self.task(), report)
        self.assertEqual(report["outcome"], "verified")
        self.assertIn("failed_checks", goals[1])
        report = {"actions": [], "decisions": []}
        run_loop(FakeBrowser(), lambda *_: self.decision("DONE"), Stale, self.task(), report)
        self.assertEqual(report["outcome"], "claimed_done")
        self.assertEqual(len(report["decisions"]), 3)

    def test_expectations_require_all_checks(self):
        self.assertTrue(verification(page(), {"text": ["before"]})["passed"])
        self.assertFalse(verification(page(), {})["passed"])
        self.assertFalse(verification(page(), {"text": ["before", "after"]})["passed"])

    def test_chrome_endpoint_is_loopback_and_never_guesses_other_browsers(self):
        with patch.dict("os.environ", {}, clear=True), patch("chrome.sys.platform", "darwin"):
            with patch.object(Path, "read_text", return_value="9222\n/devtools/browser/a1-b2\n"):
                self.assertEqual(chrome_endpoint(), "ws://127.0.0.1:9222/devtools/browser/a1-b2")
            with patch.object(Path, "read_text", side_effect=FileNotFoundError):
                with self.assertRaisesRegex(ValueError, "开启远程调试"):
                    chrome_endpoint()
            with patch.object(Path, "read_text", return_value="9222\n//remote.example\n"):
                with self.assertRaises(ValueError):
                    chrome_endpoint()

    def test_diagnostics_do_not_copy_arbitrary_exception_contents(self):
        self.assertEqual(failure_reason(RuntimeError("secret-value")), "RuntimeError")
        self.assertEqual(
            failure_reason(RuntimeError("Model provider returned HTTP 401; secret-value")),
            "jev_http_401",
        )

    def test_pinned_selector_uses_official_api_and_environment_key(self):
        import httpx

        # The upstream package __init__ also imports Harness; isolate its paths
        # before that import, exactly as the production entry point does.
        with patch.dict("os.environ", {}, clear=True):
            configure_harness()
            from jev_ultrafast import model

        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(
                200,
                json={
                    "model": "jev-1.13.0",
                    "answers": {
                        "operation": {
                            "choice": "CLICK",
                            "confidence": 1,
                            "probabilities": {"CLICK": 1, "DONE": 0, "BLOCKED": 0},
                        },
                        "click_target": {
                            "choice": "1",
                            "confidence": 1,
                            "probabilities": {"1": 1},
                        },
                    },
                },
            )

        state = page()
        state["actions"][0]["node"] = 1
        goal, history = model_context(
            {**self.task(), "goal": "打开检查项"},
            {
                "actions": [
                    {"action": "未执行输入", "kind": "fill", "outcome": "stale_not_executed"}
                ]
            },
            state,
        )
        with (
            httpx.Client(transport=httpx.MockTransport(respond)) as client,
            patch.object(model, "CLIENT", client),
            patch.dict(
                "os.environ", {"TYPESAFE_API_KEY": "offline-key", "TYPESAFE_MODEL": "jev-1.13.0"}
            ),
        ):
            decision = model.choose(state, goal, history)
        self.assertEqual(decision["choice"], "1")
        self.assertEqual(len(requests), 1)
        self.assertEqual(str(requests[0].url), "https://api.typesafe.ai/v1/systemone")
        self.assertEqual(requests[0].headers["authorization"], "Bearer offline-key")
        self.assertEqual(json.loads(requests[0].content)["model"], "jev-1.13.0")
        body = json.loads(requests[0].content)
        self.assertEqual(body["state"]["recent_actions"], [])
        self.assertIn("stale_not_executed", body["questions"]["operation"]["instructions"]["goal"])


if __name__ == "__main__":
    unittest.main()
