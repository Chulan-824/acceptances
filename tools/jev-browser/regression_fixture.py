"""Disposable read-only path fixture for the explicit real-Chrome regression."""

import json
import tempfile
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HTML = """<!doctype html><meta charset="utf-8"><title>Jev path regression</title>
<aside><button onclick="window.sidebar++">侧栏筛选</button></aside>
<main id="home"><h1>合成需求</h1>
<input aria-label="搜索合成条目">
<button onclick="openDetail()">打开合成详情</button>
</main>
<main id="detail" hidden><h1>合成详情</h1>
<button onclick="showFiles(true)">文件</button>
<button onclick="showFiles(false)">检查清单</button>
<section id="files" hidden>合成证据</section>
<section id="checklist"><input aria-label="搜索检查项" oninput="filterItems(this.value)">
<p id="result">显示 3 / 3 项</p></section></main>
<script>
window.sidebar=0;
function openDetail() {
 history.pushState({},'', '/detail');
 document.getElementById('home').hidden=true;
 document.getElementById('detail').hidden=false;
}
function showFiles(show) {
 document.getElementById('files').hidden=!show;
 document.getElementById('checklist').hidden=show;
}
function filterItems(value) {
 document.getElementById('result').textContent=value==='唯一合成条目'
  ? '显示 1 / 3 项：唯一合成条目' : '显示 3 / 3 项';
}
</script>""".encode()


def fixture_task(url):
    detail = url.rstrip("/") + "/detail"
    return {
        "url": url,
        "goal": (
            "只读依次搜索合成条目，打开合成详情，查看文件，"
            "再返回检查清单搜索唯一合成条目。全程保持侧栏筛选不变。"
        ),
        "values": {"搜索合成条目": "合成条目", "搜索检查项": "唯一合成条目"},
        "allowed_write_labels": [],
        "max_steps": 16,
        "max_seconds": 60,
        "ready": {"text": ["合成需求"]},
        "expect": {"url": detail, "text": ["显示 1 / 3 项：唯一合成条目"]},
        "path": {
            "required": [
                {"kind": "fill", "label": "搜索合成条目", "url": url, "text": "合成条目"},
                {"kind": "click", "label": "打开合成详情", "url": url},
                {"kind": "click", "label": "文件", "url": detail},
                {"kind": "click", "label": "检查清单", "url": detail},
                {"kind": "fill", "label": "搜索检查项", "url": detail, "text": "唯一合成条目"},
            ],
            "forbidden": [{"kind": "click", "label": "侧栏筛选"}],
        },
    }


@contextmanager
def synthetic_task():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="acceptances-jev-path-") as directory:
            path = Path(directory) / "task.json"
            path.write_text(
                json.dumps(
                    fixture_task(f"http://127.0.0.1:{server.server_port}/"), ensure_ascii=False
                )
            )
            yield path
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
