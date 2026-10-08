/*
 * Provenance notice (recorded 2026-10-08); renderer origin/derivation remains pending.
 * Report viewer information architecture has upstream correspondences; local reviews use filesystem APIs.
 * AI-assisted local rewrite referenced lobehub/lobehub@1c7a7116313bcc2d675937139554a244f7adf7a0.
 * Applicable upstream portions retain LobeHub Community License + Apache-2.0 and
 * Copyright (c) 2024/06/17 - current LobeHub LLC. All rights reserved.
 * See ../LICENSE-SCOPE.md, ../NOTICE and ../docs/licensing/lobehub-provenance.md.
 * This notice does not certify the whole component as derived or grant MIT.
 */
import { useMemo, useState } from "react";

import { postJson, url, useJson } from "./api";
import { Evidence } from "./Evidence";
import type { Delivery, DeliveryItem, Review, Status, ValidationDiagnostic, Verdict } from "./types";
import { Visualizations } from "./Visualizations";

const STATUS: Record<Status, { glyph: string; label: string }> = {
  pass: { glyph: "✓", label: "通过" },
  fail: { glyph: "×", label: "失败" },
  blocked: { glyph: "!", label: "阻塞" },
  "not-run": { glyph: "○", label: "未执行" },
};

function verdictLabel(verdict: Verdict) {
  if (verdict === "pass") return "通过";
  if (verdict === "fail") return "失败";
  if (verdict === "partial") return "部分通过";
  return verdict || "无结论";
}

function reviewLabel(review: Review | null) {
  if (review?.action === "accept") return { className: "accept", label: "已通过" };
  if (review?.action === "reject") return { className: "reject", label: "已拒绝" };
  return { className: "unset", label: "未审" };
}

function shortStamp(value: string) {
  const match = value.match(/\d{4}-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]} ${match[3]}:${match[4]}` : value;
}

function groupItems(items: DeliveryItem[]) {
  const groups = new Map<string, DeliveryItem[]>();
  for (const item of items) {
    const category = item.plan?.category || item.case?.category || "未分类";
    const bucket = groups.get(category) || [];
    bucket.push(item);
    groups.set(category, bucket);
  }
  return [...groups.entries()];
}

function History({ item, delivery }: { item: DeliveryItem; delivery: Delivery }) {
  if (item.history.length <= 1) return null;
  return (
    <details className="history">
      <summary>迭代历史（{item.history.length} 轮）</summary>
      <ol>
        {item.history.map((entry) => (
          <li key={entry.round}>
            <a href={entry.index ? url("/subject", { root: delivery.root, subject: delivery.subject, r: entry.index }) : url("/round", { root: delivery.root, subject: delivery.subject, round: entry.round })}>
              {entry.index ? `第 ${entry.index} 轮` : entry.round}
            </a>{" "}
            <span className={`badge ${entry.status}`}>{STATUS[entry.status].label}</span>{" "}
            <span className="muted">{shortStamp(entry.createdAt)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function ReviewActions({
  delivery,
  item,
  onReviewed,
}: {
  delivery: Delivery;
  item: DeliveryItem;
  onReviewed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!item.case || delivery.validationOutcome === "legacy" || delivery.validationOutcome === "rejected") return null;

  async function submit(action: "accept" | "reject") {
    setError("");
    if (action === "reject" && !reason.trim()) {
      setError("拒绝时必须填写评论。");
      return;
    }
    setBusy(true);
    try {
      await postJson("/api/review", {
        root: delivery.root,
        subject: delivery.subject,
        round: item.sourceRound,
        id: item.id,
        action,
        reason,
      });
      onReviewed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-actions">
      <label>
        <span className="sr-only">拒绝评论</span>
        <textarea
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          placeholder="拒绝并评论（必填）"
          value={reason}
        />
      </label>
      <button className="reject-button" disabled={busy} type="button" onClick={() => submit("reject")}>
        拒绝并评论
      </button>
      <button className="accept-button" disabled={busy || item.held} title={item.held ? "held 检查项不能验收通过" : undefined} type="button" onClick={() => submit("accept")}>
        验收通过
      </button>
      {error ? <p className="action-error" role="alert">{error}</p> : null}
    </div>
  );
}

function CheckCard({ delivery, item, latestIndex, onReviewed }: { delivery: Delivery; item: DeliveryItem; latestIndex: number; onReviewed: () => void }) {
  const status = STATUS[item.status];
  const review = reviewLabel(item.review);
  const open = item.status !== "pass" || !item.review;
  const title = item.case?.name || item.plan?.title || item.id;
  return (
    <article className="check" id={`case-${item.id}`}>
      <details open={open ? true : undefined}>
        <summary>
          <span className={`status-mark ${item.status}`} title={`跑测 ${status.label}`}>{status.glyph}</span>
          <span><span className="case-id">{item.id}</span><span className="check-title">{title}</span></span>
          <span className={`badge ${item.case ? review.className : "not-run"}`}>{item.case ? review.label : "未执行"}</span>
        </summary>
        <div className="check-body">
          {item.case ? <p className="observation">{item.case.observation || "无观测说明"}</p> : <p className="observation muted">本轮计划了该项，但没有产生 case。</p>}
          {item.held ? <p className="source-note">校验状态为 held，不能验收通过。</p> : null}
          {item.staleReview ? <p className="source-note">存在封存前人审，已标记为 stale。</p> : null}
          {delivery.mode === "union" && item.sourceIndex !== null && item.sourceIndex < latestIndex ? <p className="source-note">最近执行于第 {item.sourceIndex} 轮</p> : null}
          {item.plan?.expected ? <p className="detail-line">期望：{item.plan.expected}</p> : null}
          {item.plan?.method ? <p className="detail-line">方法：{item.plan.method}</p> : null}
          {item.review?.reason ? <p>拒绝理由：{item.review.reason}</p> : null}
          {item.review?.reviewedAt ? <p className="muted">人审于 {item.review.reviewedAt}</p> : null}
          {item.case ? (
            <>
              <Evidence evidence={item.case.evidence} evidenceTexts={item.evidenceTexts} root={delivery.root} round={item.sourceRound} subject={delivery.subject} />
              <Visualizations datasets={item.case.datasets} views={item.case.visualizations} />
            </>
          ) : null}
          <History delivery={delivery} item={item} />
          <ReviewActions delivery={delivery} item={item} onReviewed={onReviewed} />
        </div>
      </details>
    </article>
  );
}

function Ledger({ delivery }: { delivery: Delivery }) {
  return (
    <aside className="ledger">
      <h2><span>运行记录</span><small>{delivery.rounds.length}</small></h2>
      <a className={`round-card overview ${delivery.mode === "union" ? "is-current" : ""}`} href={url("/subject", { root: delivery.root, subject: delivery.subject })}>
        <strong>跨轮总览</strong>
        <span className="muted">按检查项合并最近结果</span>
      </a>
      {delivery.rounds.map((round) => (
        <a
          className={`round-card ${delivery.selectedRound === round.id ? "is-current" : ""}`}
          href={round.sequence ? url("/subject", { root: delivery.root, subject: delivery.subject, r: round.sequence }) : url("/round", { root: delivery.root, subject: delivery.subject, round: round.id })}
          key={round.id}
        >
          <div className="round-top"><strong>{round.sequence ? `第 ${round.sequence} 轮` : "未封存"}</strong><span className="muted">{shortStamp(round.createdAt)}</span></div>
          <div className="round-title">{round.title}</div>
          <div className="round-foot"><span className={`badge ${round.state}`}>{round.state}</span> {round.passed}/{round.total} 通过 · {round.state === "legacy" || round.state === "rejected" ? "不可人审" : round.pendingReview ? `${round.pendingReview} 项未审` : "人审已齐"}</div>
        </a>
      ))}
    </aside>
  );
}

function Diagnostics({ entries }: { entries: ValidationDiagnostic[] }) {
  if (!entries.length) return null;
  return (
    <section className="diagnostics">
      <h2>校验诊断 <small>{entries.length}</small></h2>
      <ol>
        {entries.map((entry, index) => (
          <li className={`diagnostic ${entry.effect}`} key={`${entry.round || "current"}-${entry.code}-${entry.path}-${index}`}>
            <div><span className={`badge ${entry.effect}`}>{entry.effect}</span> <code>{entry.code}</code></div>
            <p>{entry.message}</p>
            <small>{entry.round ? `${entry.round} · ` : ""}{entry.path} · {entry.source}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DeliveryPage() {
  const params = new URLSearchParams(location.search);
  const root = params.get("root") || "";
  const subject = params.get("subject") || "";
  const selection = location.pathname === "/round" ? { round: params.get("round") } : { r: params.get("r") };
  const endpoint = url("/api/delivery", { root, subject, ...selection });
  const [revision, setRevision] = useState(0);
  const { data, error, loading } = useJson<Delivery>(endpoint, revision);
  const groups = useMemo(() => groupItems(data?.items || []), [data?.items]);

  if (loading) return <main className="state"><p>正在读取验收交付…</p></main>;
  if (error || !data) return <main className="state"><h1>读取失败</h1><p className="error">{error}</p><a href="/">返回本地验收</a></main>;
  const latestIndex = Math.max(0, ...data.rounds.map((round) => round.sequence || 0));
  const meta = [
    data.mode === "union" ? "跨轮总览" : data.selectedIndex ? `第 ${data.selectedIndex} 轮` : data.selectedRound,
    data.createdAt,
    data.branch,
    data.commit ? data.commit.slice(0, 8) : "",
    data.entry,
    data.ruleset,
    data.digest ? data.digest.slice(0, 12) : "",
  ].filter(Boolean);

  return (
    <>
      <nav className="crumb delivery-crumb">
        <a href="/">本地验收</a> / <a href={url("/root", { root: data.root })}>{data.subject}</a> / {data.mode === "union" ? "跨轮总览" : data.selectedIndex ? `第 ${data.selectedIndex} 轮` : data.selectedRound}
      </nav>
      <main className="delivery-shell">
        <div>
          <header className="hero">
            <div className="row"><span className={`badge ${data.validationOutcome}`}>{data.validationOutcome}</span><span className={`badge ${data.summary.verdict || "unset"}`}>{verdictLabel(data.summary.verdict)}</span><span className="muted">{data.summary.passed}/{data.summary.total} 跑测通过{data.summary.notRun ? ` · ${data.summary.notRun} 未执行` : ""}</span></div>
            <h1>{data.title}</h1>
            <p className="meta">{meta.join(" · ")}</p>
            {data.summary.conclusion ? <p className="conclusion">{data.summary.conclusion}</p> : null}
          </header>
          {groups.map(([category, items]) => {
            const accepted = items.filter((item) => item.review?.action === "accept").length;
            return (
              <section className="category" key={category}>
                <header><strong>{category}</strong><span>{accepted}/{items.length} 已验收</span></header>
                {items.map((item) => <CheckCard delivery={data} item={item} key={item.id} latestIndex={latestIndex} onReviewed={() => setRevision((value) => value + 1)} />)}
              </section>
            );
          })}
          {!groups.length ? <section className="card"><p>当前没有可进入验收 union 的 Published Round。</p></section> : null}
          <Diagnostics entries={data.diagnostics} />
          {data.report ? <section className="notes"><h2>本轮备注</h2><pre>{data.report}</pre></section> : null}
        </div>
        <Ledger delivery={data} />
      </main>
      <footer className="dock"><span>共 {data.pendingReview} 项等待你的验收</span><span className="muted">人审只写对应 Round 的 reviews.json</span></footer>
    </>
  );
}
