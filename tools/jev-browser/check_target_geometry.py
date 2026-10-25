"""Opt-in real Chrome regression on disposable synthetic data; no model requests."""

import argparse
import base64
import json
import os
import threading
import time
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import jev_browser as executor
import launch

HTML = b"""<!doctype html><meta charset="utf-8"><title>Target geometry regression</title>
<style>
button,input,select {position:absolute;left:20px;height:40px;box-sizing:border-box}
.under {width:1000px} .target {left:40px;width:32px;white-space:nowrap;overflow:hidden}
button {top:100px} input {top:180px} select {top:260px}
@keyframes move {to {transform:translateX(300px)}}
.moving {animation:move 150ms linear infinite alternate}
#decoration {position:absolute;top:400px;width:20px;height:20px;background:blue}
</style><h1>Disposable synthetic controls</h1>
<button class="under" id="under" onclick="window.other++">Delete synthetic</button>
<button class="target" id="moving" onclick="window.intended++">Open synthetic details</button>
<input class="under" id="underInput" aria-label="Other field" value="untouched">
<input class="target" id="field" aria-label="Target field" value="before">
<select class="under" id="underSelect" aria-label="Other category">
<option>A</option><option>B</option></select>
<select class="target" id="category" aria-label="Target category">
<option>A</option><option>B</option></select>
<button id="decoration" class="moving">Unrelated animated control</button>
<script>
window.other=0;window.intended=0;window.inputs=[];
for (const name of ['mousedown','input','change'])
 document.addEventListener(name,event=>window.inputs.push([name,event.target.id]),true);
</script>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(HTML)

    def log_message(self, *_):
        pass


def check(browser, stale, task, report):
    checks = {}

    def observe(label, kind):
        page = browser.observe(screenshot=False)
        action = next(a for a in page["actions"] if a["label"] == label and a["kind"] == kind)
        return page, action

    def rejected(page, action):
        with executor.deadline(3):
            try:
                browser.act(action, page, text="must not be inserted")
            except stale:
                return True
        return False

    # Width and velocity match the P1 reproduction, with no injected protocol delay.
    for node, label, kind in (
        ("moving", "Open synthetic details", "click"),
        ("field", "Target field", "fill"),
        ("category", "Target category \u2192 B", "select"),
    ):
        browser.evaluate(f"document.getElementById('{node}').classList.add('moving')")
        page, action = observe(label, kind)
        checks["moving_" + kind + "_rejected"] = rejected(page, action)
        browser.evaluate(f"document.getElementById('{node}').classList.remove('moving')")
    checks["moving_targets_send_no_input"] = browser.evaluate(
        "window.inputs.length===0 && window.other===0 && window.intended===0 && "
        "field.value==='before' && underInput.value==='untouched' && "
        "category.value==='A' && underSelect.value==='A'"
    )

    browser.evaluate("moving.classList.add('moving')")
    page, action = observe("Open synthetic details", "click")
    browser.evaluate("setTimeout(()=>moving.classList.remove('moving'),250)")
    started = time.monotonic()
    browser.act(action, page)
    checks["stopped_target_clicks_only_intended_control"] = (
        browser.evaluate("window.intended===1 && window.other===0")
        and time.monotonic() - started >= 0.35
    )

    page, action = observe("Target field", "fill")
    browser.act(action, page, text="verified")
    checks["static_fill_with_unrelated_animation"] = browser.evaluate(
        "field.value==='verified' && underInput.value==='untouched' && "
        "decoration.getAnimations().some(a=>a.playState==='running')"
    )
    page, action = observe("Target category \u2192 B", "select")
    browser.act(action, page)
    checks["static_select_preserves_native_events"] = browser.evaluate(
        "category.value==='B' && underSelect.value==='A' && "
        "window.inputs.some(([name,id])=>name==='change' && id==='category')"
    )

    browser.evaluate("window.inputs=[]")
    for name, mutation, restore in (
        ("label", "moving.textContent='Changed'", "moving.textContent='Open synthetic details'"),
        ("disabled", "moving.disabled=true", "moving.disabled=false"),
        (
            "overlay",
            "document.body.insertAdjacentHTML('beforeend',"
            "'<div id=cover style=\"position:fixed;inset:0;z-index:9999\"></div>')",
            "cover.remove()",
        ),
        ("replacement", "moving.replaceWith(moving.cloneNode(true))", "void 0"),
    ):
        page, action = observe("Open synthetic details", "click")
        browser.evaluate("setTimeout(()=>{" + mutation + "},50)")
        checks[name + "_during_geometry_wait_rejected"] = rejected(page, action)
        browser.evaluate(restore)
    page, action = observe("Target field", "fill")
    browser.evaluate("setTimeout(()=>{field.readOnly=true},50)")
    checks["readonly_during_geometry_wait_rejected"] = rejected(page, action)
    browser.evaluate("field.readOnly=false")
    checks["changed_targets_send_no_input"] = browser.evaluate("window.inputs.length===0")

    browser.evaluate("moving.classList.add('moving')")
    loop = {"actions": [], "decisions": []}

    def choose(page, *_):
        return {
            "choice": next(
                a["id"] for a in page["actions"] if a["label"] == "Open synthetic details"
            )
        }

    try:
        with executor.deadline(10):
            executor.run_loop(browser, choose, stale, task, loop)
        checks["moving_retry_is_bounded_and_not_executed"] = False
    except executor.HandBack as error:
        checks["moving_retry_is_bounded_and_not_executed"] = (
            str(error) == "stale_retry_exhausted"
            and len(loop["actions"]) == 3
            and all(a["outcome"] == "stale_not_executed" for a in loop["actions"])
            and browser.evaluate("window.inputs.length===0 && window.other===0")
        )
    report["loop_actions"] = loop["actions"]
    report["checks"] = checks
    if not all(checks.values()):
        raise AssertionError({name: value for name, value in checks.items() if not value})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    os.environ.update(launch.project_environment(dict(os.environ)))
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    output = args.output or launch.evidence_directory(os.environ) / (stamp + "-target-geometry")
    output.mkdir(parents=True, exist_ok=False)
    endpoint = executor.chrome_endpoint(resolve_docker_host=True)
    executor.configure_harness(endpoint)
    os.environ["BU_CDP_WS" if endpoint.startswith(("ws:", "wss:")) else "BU_CDP_URL"] = endpoint
    report = {"outcome": "failed", "environment_class": "real-chrome-no-model"}
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    task = {
        "url": url,
        "goal": "Open synthetic details",
        "values": {},
        "allowed_write_labels": [],
        "max_steps": 10,
        "timeouts": {"navigation": 3, "data_ready": 3},
    }
    try:
        with executor.browser_session(report) as (Browser, StalePage):
            browser = Browser.__new__(Browser)
            browser.target = None
            try:
                with executor.deadline(45):
                    Browser.__init__(browser, url)
                    check(browser, StalePage, task, report)
                    shot = browser.call("Page.captureScreenshot", format="jpeg", quality=72)
                    data = base64.b64decode(shot["data"], validate=True)
                    assert data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9")
                    (output / "final.jpg").write_bytes(data)
                    report["outcome"] = "verified"
            finally:
                with executor.deadline(8):
                    browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        (output / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"outcome": report["outcome"], "output": str(output)}))


if __name__ == "__main__":
    main()
