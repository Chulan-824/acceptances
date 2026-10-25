import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export async function checkWeb(base, request = fetch) {
  const receipts = [];
  const get = async (path) => {
    const response = await request(new URL(path, base), {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.length, `${path}: 空响应`);
    receipts.push({
      path,
      bytes: body.length,
      contentType: response.headers.get("content-type") || "",
      sha256: createHash("sha256").update(body).digest("hex"),
    });
    return { body, type: receipts.at(-1).contentType };
  };
  for (const [path, status] of [
    ["/health/live", "alive"],
    ["/health/ready", "ready"],
  ]) {
    const { body, type } = await get(path);
    assert.match(type, /application\/json/, path);
    assert.equal(JSON.parse(body).status, status, path);
  }
  const { body, type } = await get("/");
  assert.match(type, /text\/html/);
  const html = body.toString();
  assert.match(html, /id=["']root["']/, "缺少 Web 根节点");
  const queue = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .filter((match) => !/^(?:data:|#)/.test(match[1]))
    .map((match) => {
      const url = new URL(match[1], base);
      assert.equal(
        url.origin,
        new URL(base).origin,
        "首页资源必须来自当前服务",
      );
      return url.pathname + url.search;
    });
  assert.ok(
    queue.some((path) => /\.js$/.test(path)),
    "缺少生产 JS 入口",
  );
  assert.ok(
    queue.some((path) => /\.css$/.test(path)),
    "缺少生产 CSS 入口",
  );
  for (const font of [
    "Geist-Variable",
    "Geist-Italic-Variable",
    "GeistMono-Variable",
    "GeistMono-Italic-Variable",
  ]) {
    queue.push(`/fonts/geist/${font}.woff2`);
  }
  queue.push("/fonts/geist/OFL.txt");
  const seen = new Set();
  while (queue.length) {
    const reference = queue.shift();
    const url = new URL(reference, base);
    assert.equal(url.origin, new URL(base).origin, "静态资源必须来自当前服务");
    const path = url.pathname + url.search;
    if (seen.has(path)) continue;
    seen.add(path);
    const { body, type } = await get(path);
    const text = body.toString();
    if (url.pathname.endsWith(".woff2")) {
      assert.equal(body.subarray(0, 4).toString(), "wOF2", path);
    } else if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css")) {
      assert.match(
        type,
        url.pathname.endsWith(".js") ? /javascript/ : /text\/css/,
        path,
      );
      // shortcut: 仅检查字面量 ESM/CSS 引用；需覆盖计算路径时改用构建 manifest。
      const script = url.pathname.endsWith(".js");
      const references = script
        ? [
            ...text.matchAll(
              /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+\.(?:js|css))["']/g,
            ),
          ].map((match) => match[1])
        : [
            ...text.matchAll(
              /url\(\s*["']?([^"')\s]+)["']?\s*\)|@import\s+["']([^"']+)["']/g,
            ),
          ].map((match) => match[1] || match[2]);
      for (const reference of references) {
        if (
          !/^(?:data:|#)/.test(reference) &&
          (!script || /^(?:\/|\.\.?\/)/.test(reference))
        ) {
          const child = new URL(reference, url);
          assert.equal(child.origin, url.origin, "静态资源引用离开当前服务");
          queue.push(child.pathname + child.search);
        }
      }
    } else {
      assert.doesNotMatch(
        type,
        /text\/html/,
        `${path}: 静态资源被 SPA 回退替代`,
      );
    }
  }
  const unknown = await request(new URL("/api/v1/unknown", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(unknown.status, 404);
  return receipts;
}
