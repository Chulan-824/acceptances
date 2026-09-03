import { useState } from "react";

import { postJson, url, useJson } from "./api";
import type { CatalogRoot } from "./types";

export function HomePage() {
  const [revision, setRevision] = useState(0);
  const { data, error, loading } = useJson<{ roots: CatalogRoot[] }>(
    "/api/catalog",
    revision,
  );

  async function remove(root: string) {
    if (!confirm("只从清单移除，不删除磁盘上的 Round。继续？")) return;
    await postJson("/api/unregister", { root });
    setRevision((value) => value + 1);
  }

  return (
    <main className="page-narrow">
      <nav className="crumb">本地验收</nav>
      <h1>已登记的 .acceptances</h1>
      {loading ? <p className="muted">正在读取清单…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {!loading && data?.roots.length === 0 ? (
        <p className="muted">清单为空，请通过 acceptance-cl 登记项目。</p>
      ) : null}
      {data?.roots.map((entry) => (
        <article className="card" key={entry.root}>
          <div className="row">
            <span className={`badge ${entry.alive ? "pass" : "dead"}`}>
              {entry.alive ? "可打开" : "打不开"}
            </span>
            <code>{entry.root}</code>
          </div>
          <p className="muted">
            登记 {entry.registeredAt || "—"} · 更新 {entry.updatedAt || "—"}
          </p>
          <div className="row">
            {entry.alive ? (
              <a href={url("/root", { root: entry.root })}>打开</a>
            ) : (
              <span className="dead-note">路径不存在，未自动删除</span>
            )}
            <button className="link-button" type="button" onClick={() => remove(entry.root)}>
              从清单拿掉
            </button>
          </div>
        </article>
      ))}
    </main>
  );
}
