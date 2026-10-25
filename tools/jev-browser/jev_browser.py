"""Batch tasks on real Chrome using pinned jev-ultrafast and the official Jev API."""

from __future__ import annotations

import argparse
import base64
import hashlib
import importlib.metadata
import json
import os
import re
import signal
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from chrome import chrome_endpoint

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = "1231850a0bf1a0c0341fe408ef1668dbbfdfac46"
MODEL = "jev-1.13.0"
WRITE_VERBS = re.compile(
    r"删除|保存|提交|发布|作废|撤回|通过|确认|创建|新建|添加|导入|上传|交付|冻结|"
    r"\b(delete|save|submit|publish|void|revoke|approve|confirm|create|add|import|upload|send)\b",
    re.IGNORECASE,
)


class HandBack(Exception):
    """Stop without retrying a possibly mutating action."""


def emit(value):
    print(json.dumps(value, ensure_ascii=False, indent=2), flush=True)


def local_origin(url):
    if not isinstance(url, str):
        raise ValueError("URL 必须为文本")
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
    ):
        raise ValueError("只支持不含凭据的本机 http URL")
    return parsed.scheme, parsed.hostname, parsed.port or 80


def load_task(path):
    if any(part.startswith(".env") for part in path.parts):
        raise ValueError("不能读取 .env* 文件作为任务")
    task = json.loads(path.read_text())
    if not isinstance(task, dict):
        raise ValueError("任务必须是 JSON 对象")
    local_origin(task.get("url"))
    if not isinstance(task.get("goal"), str) or not task["goal"].strip():
        raise ValueError("任务需要非空 goal")
    values = task.setdefault("values", {})
    if not isinstance(values, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) or len(v) > 2000 for k, v in values.items()
    ):
        raise ValueError("values 必须是字段完整标签到文本值的映射")
    allowed = task.setdefault("allowed_write_labels", [])
    if not isinstance(allowed, list) or any(not isinstance(x, str) for x in allowed):
        raise ValueError("allowed_write_labels 必须是完整标签数组")
    for name, default, upper in [("max_steps", 30, 60), ("max_seconds", 120, 300)]:
        value = task.setdefault(name, default)
        if type(value) is not int or not 1 <= value <= upper:
            raise ValueError(f"{name} 必须为 1–{upper} 的整数")
    timeouts = task.setdefault("timeouts", {})
    if not isinstance(timeouts, dict) or set(timeouts) - {"navigation", "login", "data_ready"}:
        raise ValueError("timeouts 只支持 navigation、login 和 data_ready")
    for name, default in [("navigation", 30), ("login", 15), ("data_ready", 30)]:
        value = timeouts.setdefault(name, default)
        if type(value) is not int or not 1 <= value <= 60:
            raise ValueError(f"timeouts.{name} 必须为 1–60 的整数")
    for name in ("expect", "ready"):
        expect = task.get(name, {})
        if not isinstance(expect, dict) or set(expect) - {"url", "text"}:
            raise ValueError(f"{name} 只支持 url 和 text")
        if name == "ready" and name in task and not expect:
            raise ValueError("ready 必须提供入口数据就绪的 url 或 text 断言")
        if "url" in expect and local_origin(expect["url"]) != local_origin(task["url"]):
            raise ValueError("预期 URL 必须与入口同源")
        if "text" in expect and (
            not isinstance(expect["text"], list)
            or not expect["text"]
            or any(not isinstance(x, str) or not x.strip() for x in expect["text"])
        ):
            raise ValueError(f"{name}.text 必须为非空文本数组")
    return task


def verification(page, expect):
    checks = {}
    if "url" in expect:
        checks["url"] = page["url"] == expect["url"]
    for index, text in enumerate(expect.get("text", [])):
        checks[f"text-{index + 1}"] = text in page["text"]
    return {"checks": checks, "passed": bool(checks) and all(checks.values())}


def action_text(action, task):
    label = action["label"]
    if WRITE_VERBS.search(label) and label not in task["allowed_write_labels"]:
        raise HandBack("write_action_requires_explicit_label")
    if action["kind"] == "fill":
        if label not in task["values"]:
            raise HandBack("text_value_missing")
        return task["values"][label]
    return None


@contextmanager
def deadline(seconds, reason="time_budget_exhausted"):
    def stop(_signum, _frame):
        raise HandBack(reason)

    started = time.monotonic()
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    previous_handler = signal.getsignal(signal.SIGALRM)
    # Nested stages must never extend or rename the remaining task deadline.
    outer_first = previous_timer[0] > 0 and previous_timer[0] <= seconds
    signal.signal(signal.SIGALRM, previous_handler if outer_first else stop)
    signal.setitimer(signal.ITIMER_REAL, previous_timer[0] if outer_first else seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer[0] > 0:
            remaining = previous_timer[0] - (time.monotonic() - started)
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, previous_timer[1])


@contextmanager
def measure(report, name):
    entry = report.setdefault("performance", {}).setdefault(
        name, {"count": 0, "elapsed_seconds": 0, "failures": 0}
    )
    entry["count"] += 1
    started = time.perf_counter()
    try:
        yield
    except BaseException:
        entry["failures"] += 1
        raise
    finally:
        entry["elapsed_seconds"] = round(
            entry["elapsed_seconds"] + time.perf_counter() - started, 6
        )


@contextmanager
def stage(report, name, seconds):
    entry = {"stage": name, "limit_seconds": seconds, "outcome": "ready"}
    report.setdefault("timings", []).append(entry)
    started = time.monotonic()
    try:
        with deadline(seconds, name + "_timeout"):
            yield
    except BaseException:
        entry["outcome"] = "interrupted"
        raise
    finally:
        entry["elapsed_seconds"] = round(time.monotonic() - started, 3)


# Read only visibility/state; never inspect password values or browser credentials.
READINESS = r"""(() => {
 const visible = e => e.getBoundingClientRect().width > 0 &&
   e.getBoundingClientRect().height > 0 &&
   e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true});
 return {
   login: [...document.querySelectorAll('input[type="password"]')].some(visible) ||
     /(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/i.test(location.pathname),
   busy: document.readyState === 'loading' ||
     [...document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning,.ant-skeleton')]
       .some(visible)
 };
})()"""


# Sample only the chosen target; unrelated layout animations must not block input.
TARGET_GEOMETRY = r"""(node => new Promise(resolve => {
 const element = window.__jevFast?.nodes.get(node);
 let frame = 0, timer = 0, previous = null, stableSince = performance.now();
 const finish = value => {
   clearTimeout(timer); cancelAnimationFrame(frame); resolve(value);
 };
 const sample = () => {
   if (!element?.isConnected || window.__jevFast?.nodes.get(node) !== element)
     return finish(false);
   const r = element.getBoundingClientRect(), rect = [r.x,r.y,r.width,r.height];
   if (!r.width || !r.height) return finish(false);
   const now = performance.now();
   if (!previous || rect.some((value,index) => value !== previous[index])) stableSince = now;
   previous = rect;
   if (now - stableSince >= 150) return finish(true);
   frame = requestAnimationFrame(sample);
 };
 timer = setTimeout(() => finish(false), 1000);
 sample();
}))"""


@contextmanager
def browser_session(report):
    from jev_ultrafast import browser as upstream

    original = upstream.cdp
    combined = (
        "(() => { const page=" + upstream.READ_STATE + ";"
        "if (page) page.readiness=" + READINESS + "; return page; })()"
    )

    def call(method, **params):
        # The pinned observer calls cdp directly; intercept only its exact snapshot expression.
        if method == "Runtime.evaluate" and params.get("expression") == upstream.READ_STATE:
            params["expression"] = combined
        with measure(report, "cdp." + method):
            return original(method, **params)

    class Browser(upstream.Browser):
        def act(self, action, page, text=None):
            if action["kind"] in {"click", "fill", "select"}:
                node = action.get("node")
                if type(node) is not int:
                    raise ValueError("Invalid observed node")
                with measure(report, "target_geometry"):
                    response = self.call(
                        "Runtime.evaluate",
                        expression=TARGET_GEOMETRY + "(" + str(node) + ")",
                        awaitPromise=True,
                        returnByValue=True,
                    )
                    if (
                        response.get("exceptionDetails")
                        or response.get("result", {}).get("value") is not True
                    ):
                        raise upstream.StalePage("Target geometry did not settle; no input sent.")
            return super().act(action, page, text=text)

    # shortcut: one synchronous task per process; replace this hook before adding concurrency.
    upstream.cdp = call
    try:
        yield Browser, upstream.StalePage
    finally:
        upstream.cdp = original


def observe_ready(browser, task, report, *, initial=False):
    limits = task.get("timeouts", {})

    def observe():
        with measure(report, "snapshot"):
            return browser.observe(screenshot=False)

    with stage(report, "login", limits.get("login", 15)):
        status = browser.evaluate(READINESS)
        while status["login"]:
            with measure(report, "login_wait"):
                time.sleep(0.1)
            status = browser.evaluate(READINESS)
    with stage(report, "data_ready", limits.get("data_ready", 30)):
        current = observe()
        stable_since = time.monotonic()
        while True:
            if local_origin(current["url"]) != local_origin(task["url"]):
                raise HandBack("navigation_left_task_origin")
            status = current["readiness"]
            if status["login"]:
                raise HandBack("login_required")
            ready = (
                not initial
                or not task.get("ready")
                or verification(current, task["ready"])["passed"]
            )
            if not status["busy"] and ready and time.monotonic() - stable_since >= 0.15:
                return current
            with measure(report, "poll_wait"):
                time.sleep(0.05)
            following = observe()
            if any(following[key] != current[key] for key in ("marker", "scroll", "readiness")):
                stable_since = time.monotonic()
            current = following


def configure_harness(endpoint="default"):
    # The pinned Harness auto-loads two .env files at import. Use a private workspace
    # and refuse to import if either file exists, without reading its contents.
    home = Path(os.environ.get("JEV_STATE_DIR") or ROOT / ".cache/jev-browser/harness")
    workspace = home / "agent-workspace"
    source = importlib.metadata.distribution("browser-harness").locate_file(
        "browser_harness/admin.py"
    )
    for path in (Path(source).resolve().parents[2] / ".env", workspace / ".env"):
        if path.exists():
            raise ValueError("Browser Harness 的自动加载路径存在 .env；已停止，未读取内容")
    if any(os.environ.get(k) for k in ("BU_CDP_WS", "BU_CDP_URL", "BU_BROWSER_ID")):
        raise ValueError("本入口只连接本机 Chrome；请移除 BU_CDP_WS/BU_CDP_URL/BU_BROWSER_ID")
    identity = hashlib.sha256(f"{ROOT}:{endpoint}".encode()).hexdigest()[:10]
    os.environ.update(
        BH_HOME=str(home),
        BH_CONFIG_DIR=str(home),
        BH_RUNTIME_DIR=str(Path(tempfile.gettempdir()) / f"acc-jev-{identity}"),
        BH_TMP_DIR=str(home / "tmp"),
        BH_AGENT_WORKSPACE=str(workspace),
        BU_NAME=f"acceptances-jev-{identity}",
        BH_TAB_MARKER="0",
        BH_RECORD="0",
        BH_RUNTIME_DIR_SHARED="0",
        BH_TMP_DIR_SHARED="0",
    )


def failure_reason(error):
    # Keep useful known diagnostics without copying arbitrary library messages.
    message = str(error)
    for marker, reason in (
        ("permission-blocked", "chrome_permission_required"),
        ("handshake-wait", "chrome_permission_required"),
        ("DevToolsActivePort not found", "chrome_remote_debugging_required"),
        ("remote debugging is turned off", "chrome_remote_debugging_required"),
        ("Model connection failed", "jev_connection_failed"),
        ("Invalid TypeSafe response", "jev_invalid_response"),
    ):
        if marker in message:
            return reason
    status = re.search(r"Model provider returned HTTP ([0-9]{3});", message)
    return f"jev_http_{status[1]}" if status else type(error).__name__


def dependencies():
    versions = {}
    for name in ["jev-ultrafast", "browser-harness", "httpx"]:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def model_context(task, report, page):
    # Pinned choose() drops outcome from recent_actions. Only successful actions
    # belong there; explicitly carry unsuccessful attempts in the goal context.
    completed = [entry for entry in report["actions"] if entry["outcome"] == "executed"]
    feedback = {}
    unexecuted = [
        {key: entry.get(key) for key in ("action", "kind", "outcome")}
        for entry in report["actions"][-10:]
        if entry["outcome"] != "executed"
    ]
    if unexecuted:
        feedback["unexecuted_attempts"] = unexecuted
    if report.get("completion_retries"):
        feedback["failed_checks"] = [
            key
            for key, passed in verification(page, task.get("expect", {}))["checks"].items()
            if not passed
        ]
    goal = task["goal"]
    if feedback:
        goal += (
            "\nExecutor feedback: stale_not_executed means NO input was dispatched; "
            "it does not complete a step. Only recent_actions were actually executed. "
            "Use current page evidence to recover. "
            + (
                "A previous DONE failed independent checks. "
                if report.get("completion_retries")
                else ""
            )
            + "\n"
            + json.dumps(feedback, ensure_ascii=False)
        )
    return goal, completed


def replacement_action(page, previous, url):
    if page["url"] != url:
        return None
    keys = ("kind", "label", "role", "value", "delta")
    matches = [
        action
        for action in page["actions"]
        if all(action.get(key) == previous.get(key) for key in keys)
    ]
    return matches[0] if len(matches) == 1 else None


def reveal_action(browser, action):
    node = action.get("node")
    if type(node) is not int or not hasattr(browser, "evaluate"):
        return False
    # Use only an observed node. Revealing scrolls but never activates the control.
    return (
        browser.evaluate(
            "(() => { const e=window.__jevFast?.nodes.get(" + str(node) + ");"
            "if (!e?.isConnected) return false;"
            "const r=e.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2;"
            "if (x>=0 && y>=0 && x<innerWidth && y<innerHeight && "
            "e.contains(document.elementFromPoint(x,y))) return false;"
            "const parents=[]; for(let p=e.parentElement;p;p=p.parentElement) "
            "parents.push([p,p.scrollLeft,p.scrollTop]);"
            "e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});"
            "return parents.some(([p,x,y])=>p.scrollLeft!==x || p.scrollTop!==y); })()"
        )
        is True
    )


def run_loop(browser, choose, stale_error, task, report):
    def observe():
        return observe_ready(browser, task, report)

    page = observe_ready(browser, task, report, initial=True)
    pending = None
    for _ in range(task["max_steps"] * 2):
        report["page"] = {key: page[key] for key in ("url", "title", "text")}
        report.setdefault("observations", []).append(report["page"].copy())
        if local_origin(page["url"]) != local_origin(task["url"]):
            raise HandBack("navigation_left_task_origin")
        retry = pending
        pending = None
        action = replacement_action(page, retry["action"], retry["url"]) if retry else None
        if action is None:
            retry = None
            goal, history = model_context(task, report, page)
            with measure(report, "model"):
                decision = choose(page, goal, history)
        else:
            decision = {"choice": action["id"]}
        # Do not persist upstream request bodies or environment variables.
        if retry is None:
            report["decisions"].append(
                {
                    k: decision.get(k)
                    for k in ("choice", "operation", "confidence", "model", "usage", "latency_ms")
                }
            )
        if decision["choice"] in {"DONE", "BLOCKED"}:
            with measure(report, "completion_freshness"):
                fresh = browser.fresh(page)
            if not fresh:
                page = observe()
                continue
            report["verification"] = verification(page, task.get("expect", {}))
            if (
                decision["choice"] == "DONE"
                and report["verification"]["checks"]
                and not report["verification"]["passed"]
                and report.get("completion_retries", 0) < 2
            ):
                report["completion_retries"] = report.get("completion_retries", 0) + 1
                page = observe()
                continue
            report["outcome"] = (
                "verified"
                if decision["choice"] == "DONE" and report["verification"]["passed"]
                else "claimed_done"
                if decision["choice"] == "DONE"
                else "blocked"
            )
            return
        if len(report["actions"]) >= task["max_steps"]:
            raise HandBack("action_budget_exhausted")
        action = next(a for a in page["actions"] if a["id"] == decision["choice"])
        text = action_text(action, task)
        entry = {
            "action": action["label"],
            "kind": action["kind"],
            "text": text,
            "url": page["url"],
            "outcome": "dispatching",
        }
        if retry:
            entry["retry_of"] = retry["index"]
        # A failed post-action observation cannot erase an already dispatched action.
        report["actions"].append(entry)
        try:
            with stage(report, "navigation", task.get("timeouts", {}).get("navigation", 30)):
                with measure(report, "action"):
                    browser.act(action, page, text=text)
        except stale_error:
            entry["outcome"] = "stale_not_executed"
            page = observe()
            attempts = retry["attempts"] + 1 if retry else 1
            if attempts >= 3:
                raise HandBack("stale_retry_exhausted") from None
            replacement = replacement_action(page, action, entry["url"])
            if replacement is not None:
                pending = {
                    "action": action,
                    "url": entry["url"],
                    "attempts": attempts,
                    "index": len(report["actions"]) - 1,
                }
                if len(report["actions"]) < task["max_steps"] and reveal_action(
                    browser, replacement
                ):
                    report["actions"].append(
                        {
                            "action": "Reveal " + replacement["label"],
                            "kind": "scroll",
                            "url": page["url"],
                            "outcome": "executed",
                            "page_changed": True,
                        }
                    )
                    page = observe()
            continue
        entry["outcome"] = "executed"
        next_page = observe()
        entry["page_changed"] = next_page["fingerprint"] != page["fingerprint"]
        page = next_page
        recent = report["actions"][-3:]
        if len(recent) == 3 and all(
            x.get("page_changed") is False and x["kind"] != "wait" for x in recent
        ):
            raise HandBack("no_progress")
    raise HandBack("decision_budget_exhausted")


def execute(task, output, *, observe_only=False, keep_open=False):
    if not observe_only and not os.environ.get("TYPESAFE_API_KEY", "").strip():
        raise ValueError("请在执行进程环境中设置 TYPESAFE_API_KEY；不要在聊天中发送 Key")
    report = {}
    with measure(report, "setup"):
        endpoint = chrome_endpoint(resolve_docker_host=True)
        configure_harness(endpoint)
        os.environ["BU_CDP_WS" if urlsplit(endpoint).scheme in {"ws", "wss"} else "BU_CDP_URL"] = (
            endpoint
        )
        os.environ.setdefault("TYPESAFE_MODEL", MODEL)
        from jev_ultrafast.model import choose

    with browser_session(report) as (Browser, StalePage):
        output.mkdir(parents=True, exist_ok=False)
        report.update(
            {
                "started_at": datetime.now(UTC).isoformat(),
                "upstream_commit": UPSTREAM,
                "dependencies": dependencies(),
                "model": os.environ["TYPESAFE_MODEL"],
                "environment_class": "real-chrome-no-model"
                if observe_only
                else "real-chrome-official-jev",
                "outcome": "failed",
                "actions": [],
                "decisions": [],
                "limitations": [
                    "URL/文本断言仅覆盖任务明示范围，不代表完整业务验收或人工接受。",
                    "写操作标签检查是启发式辅助；只能在获授权的数据上执行任务。",
                    "本地证据可能含可见页面内容和任务输入；不要用于含凭据的页面。",
                ],
            }
        )
        browser = Browser.__new__(Browser)
        browser.target = None
        started = time.monotonic()
        try:
            with deadline(task["max_seconds"]):
                # Retain the object so constructor failure can still clean up our own target.
                with stage(report, "navigation", task.get("timeouts", {}).get("navigation", 30)):
                    with measure(report, "browser_init"):
                        Browser.__init__(browser, task["url"])
                report["target_id"] = browser.target
                if observe_only:
                    page = observe_ready(browser, task, report, initial=True)
                    report["page"] = {key: page[key] for key in ("url", "title", "text", "actions")}
                    report["outcome"] = "observed"
                    report["environment_class"] = "real-chrome-no-model"
                else:
                    run_loop(browser, choose, StalePage, task, report)
        except HandBack as error:
            report.update(outcome="blocked", reason=str(error))
        except KeyboardInterrupt:
            report.update(outcome="interrupted", reason="user_interrupted")
        except Exception as error:
            # Exception messages from libraries can contain request headers or task contents.
            report.update(outcome="failed", reason=failure_reason(error))
        finally:
            if browser.target:
                try:
                    with deadline(8), measure(report, "screenshot"):
                        shot = browser.call("Page.captureScreenshot", format="jpeg", quality=72)
                        data = base64.b64decode(shot["data"], validate=True)
                        if not data.startswith(b"\xff\xd8\xff") or not data.endswith(b"\xff\xd9"):
                            raise ValueError("Chrome screenshot is not JPEG")
                        (output / "final.jpg").write_bytes(data)
                except Exception:
                    report["screenshot_unavailable"] = True
                if not keep_open:
                    try:
                        with deadline(8), measure(report, "cleanup"):
                            browser.close()
                    except Exception:
                        report["cleanup_failed"] = True
                        report["outcome"] = "failed"
            report["kept_open"] = bool(keep_open and browser.target)
            report["elapsed_seconds"] = round(time.monotonic() - started, 3)
            report["ended_at"] = datetime.now(UTC).isoformat()
            (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
        emit({"outcome": report["outcome"], "reason": report.get("reason"), "output": str(output)})
        return 0 if report["outcome"] in {"verified", "observed"} else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="只检查依赖和环境变量，不连接浏览器或调用模型")
    run = commands.add_parser("run", help="在真实 Chrome 执行一个 JSON 任务")
    run.add_argument("task", type=Path)
    inspect = commands.add_parser("inspect", help="连接真实 Chrome 并观察页面，不调用模型")
    inspect.add_argument("url")
    for command in (run, inspect):
        command.add_argument("--keep-open", action="store_true")
    args = parser.parse_args()
    if args.command == "doctor":
        versions = dependencies()
        key = bool(os.environ.get("TYPESAFE_API_KEY", "").strip())
        emit({"dependencies": versions, "api_key_configured": key, "browser_checked": False})
        return 0 if key and all(versions.values()) else 2
    task = (
        load_task(args.task.resolve())
        if args.command == "run"
        else {"url": args.url, "max_seconds": 30}
    )
    local_origin(task["url"])
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    output = (
        Path(os.environ.get("JEV_OUTPUT_DIR") or ROOT / "artifacts/jev-browser")
        / f"{stamp}-{os.getpid()}"
    )
    return execute(task, output, observe_only=args.command == "inspect", keep_open=args.keep_open)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as error:
        # Only our validation messages are allowed on stdout, never task content or secrets.
        message = str(error) if type(error) is ValueError else type(error).__name__
        emit({"outcome": "configuration_error", "reason": message})
        sys.exit(2)
