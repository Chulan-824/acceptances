import { useEffect, useState } from "react";
import {
  api,
  readPages,
  mutationHeaders,
  record,
  rows,
  text,
  errorMessage,
  type RecordValue,
} from "./client";
import { Definition } from "./definition";
import { Evidence } from "./evidence";
type Action =
  | "comment"
  | "reject_item"
  | "resolve_rejection"
  | "accept"
  | "reject"
  | "accept_risk"
  | "withdraw";
export function Campaign({
  project,
  campaign,
}: {
  project: string;
  campaign: string;
}) {
  const [details, setDetails] = useState<RecordValue>({});
  const [snapshot, setSnapshot] = useState<RecordValue>({});
  const [events, setEvents] = useState<RecordValue[]>([]);
  const [etag, setETag] = useState("");
  const [basisETag, setBasisETag] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [itemId, setItemId] = useState("");
  const [resolved, setResolved] = useState<string[]>([]);
  const [risk, setRisk] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<RecordValue | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    const params = { path: { projectId: project, campaignId: campaign } };
    void Promise.all([
      api.GET("/api/v1/projects/{projectId}/campaigns/{campaignId}", {
        params,
      }),
      api.GET("/api/v1/projects/{projectId}/campaigns/{campaignId}/snapshot", {
        params,
      }),
      readPages((cursor) =>
        api.GET("/api/v1/projects/{projectId}/campaigns/{campaignId}/reviews", {
          params: { ...params, query: { cursor } },
        }),
      ),
    ])
      .then(([c, s, r]) => {
        if (!active) return;
        if (c.data) {
          setDetails(record(c.data.data));
          setBasisETag(c.response.headers.get("ETag") || "");
        }
        if (s.data) {
          setSnapshot(record(s.data.data));
          setETag(s.response.headers.get("ETag") || "");
        }
        setEvents(r);
        const error = c.error || s.error;
        if (error) setError(errorMessage(error));
      })
      .catch(() => {
        if (active) setError("交付依据无法读取。");
      });
    return () => {
      active = false;
    };
  }, [project, campaign, generation]);
  const body = record(snapshot.snapshot);
  const items = rows(body.items);
  const pending = snapshot.basisPending === true;
  const valid = Boolean(text(snapshot.id)) && !pending;
  const resolvedEvents = new Set(
    events
      .filter((e) =>
        ["resolve_rejection", "accept_risk"].includes(text(e.action)),
      )
      .flatMap((e) =>
        Array.isArray(e.resolvesEventIds)
          ? e.resolvesEventIds.filter(
              (id): id is string => typeof id === "string",
            )
          : [],
      ),
  );
  const unresolvedEvents = events.filter(
    (e) =>
      ["reject", "reject_item"].includes(text(e.action)) &&
      !resolvedEvents.has(text(e.id)),
  );
  const currentDecision = [...events]
    .reverse()
    .find(
      (e) =>
        e.snapshotId === snapshot.id &&
        ["accept", "accept_risk", "reject", "withdraw"].includes(
          text(e.action),
        ),
    );
  const historical = [...events]
    .reverse()
    .find(
      (e) =>
        e.snapshotId !== snapshot.id &&
        ["accept", "accept_risk", "reject", "withdraw"].includes(
          text(e.action),
        ),
    );
  async function review(action: Action) {
    setBusy(true);
    setError("");
    try {
      const { error } = await api.POST(
        "/api/v1/projects/{projectId}/campaigns/{campaignId}/reviews",
        {
          params: {
            path: { projectId: project, campaignId: campaign },
            header: { ...mutationHeaders(), "If-Match": etag },
          },
          body: {
            id: crypto.randomUUID(),
            snapshotId: text(snapshot.id),
            action,
            ...(itemId ? { itemId } : {}),
            ...(reason ? { reason } : {}),
            ...(action === "accept_risk"
              ? {
                  riskItems: Object.entries(risk).map(([itemId, reason]) => ({
                    itemId,
                    reason,
                  })),
                  resolvesEventIds: resolved,
                }
              : action === "resolve_rejection"
                ? { resolvesEventIds: resolved }
                : {}),
          },
        },
      );
      if (error)
        setError(
          `${errorMessage(error)}。输入已保留；请刷新依据后由你重新提交。`,
        );
      else setGeneration((v) => v + 1);
    } catch {
      setError("提交状态未知，请刷新人审历史后确认，避免重复决定。");
    } finally {
      setBusy(false);
    }
  }
  async function basis(form: FormData) {
    setBusy(true);
    try {
      const { error } = await api.PATCH(
        "/api/v1/projects/{projectId}/campaigns/{campaignId}/basis",
        {
          params: {
            path: { projectId: project, campaignId: campaign },
            header: { ...mutationHeaders(), "If-Match": basisETag },
          },
          body: {
            planId: String(form.get("planId")),
            targetId: String(form.get("targetId")),
            reason: String(form.get("reason")),
          },
        },
      );
      if (error) setError(errorMessage(error));
      else setGeneration((v) => v + 1);
    } catch {
      setError("依据切换失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <header>
        <div>
          <h2>{text(details.title) || "交付活动"}</h2>
          <code>{campaign}</code>
        </div>
        <button disabled={busy} onClick={() => setGeneration((v) => v + 1)}>
          刷新依据
        </button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details>
        <summary>显式采用验收计划和目标版本</summary>
        <p>定义文档在 Git 中编辑并通过 CLI 导入，此操作切换当前验收依据。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void basis(new FormData(e.currentTarget));
          }}
        >
          <label>
            Plan ID
            <input name="planId" required defaultValue={text(details.planId)} />
          </label>
          <label>
            Target ID
            <input
              name="targetId"
              required
              defaultValue={text(details.targetId)}
            />
          </label>
          <label>
            切换原因
            <input name="reason" required />
          </label>
          <button disabled={busy}>采用依据</button>
        </form>
      </details>
      <Definition
        project={project}
        campaign={campaign}
        plan={text(details.planId)}
        target={text(details.targetId)}
      />
      <div className="status-grid">
        <article>
          <h3>执行结果</h3>
          <p>
            {items.filter((i) => i.resultRef).length} / {items.length}{" "}
            项有选中结果
          </p>
        </article>
        <article>
          <h3>证据校验</h3>
          <p>查看每项诊断与已封存报告</p>
        </article>
        <article>
          <h3>验收就绪</h3>
          <p>
            {pending ? "依据计算中" : text(body.readiness) || "尚无计划或目标"}
          </p>
        </article>
        <article>
          <h3>人工决定</h3>
          <p>
            {currentDecision &&
            unresolvedEvents.length &&
            ["accept", "accept_risk"].includes(text(currentDecision.action))
              ? "有未解决拒绝，接受已失效"
              : currentDecision
                ? text(currentDecision.action)
                : "待审"}
          </p>
          {historical && (
            <small>
              历史决定 {text(historical.action)}，不代表当前交付已接受。
            </small>
          )}
        </article>
      </div>
      <table>
        <thead>
          <tr>
            <th>计划项</th>
            <th>要求</th>
            <th>选择</th>
            <th>可计覆盖</th>
            <th>诊断与证据</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={text(i.planItemId)}>
              <td>
                <code>{text(i.planItemId)}</code>
              </td>
              <td>{i.required ? "必测" : "参考"}</td>
              <td>{text(i.selectionStatus)}</td>
              <td>{i.eligibility ? "满足" : "未满足"}</td>
              <td>
                {Array.isArray(i.codes) ? i.codes.join(", ") : ""}
                {i.resultRef ? (
                  <button onClick={() => setEvidence(record(i.resultRef))}>
                    查看封存报告
                  </button>
                ) : null}
                {text(i.selectionStatus) === "conflict" && (
                  <ul>
                    {rows(i.candidateRefs).map((ref) => (
                      <li key={text(ref.resultId)}>
                        <code>{text(ref.resultId)}</code>
                        <button
                          disabled={busy || !reason.trim()}
                          onClick={() => {
                            setBusy(true);
                            void api
                              .POST(
                                "/api/v1/projects/{projectId}/campaigns/{campaignId}/selections",
                                {
                                  params: {
                                    path: {
                                      projectId: project,
                                      campaignId: campaign,
                                    },
                                    header: {
                                      ...mutationHeaders(),
                                      "If-Match": etag,
                                    },
                                  },
                                  body: {
                                    planItemId: text(i.planItemId),
                                    resultRef: {
                                      runId: text(ref.runId),
                                      revisionId: text(ref.revisionId),
                                      resultId: text(ref.resultId),
                                    },
                                    reason,
                                  },
                                },
                              )
                              .then(({ error }) => {
                                if (error) setError(errorMessage(error));
                                else setGeneration((v) => v + 1);
                              })
                              .catch(() =>
                                setError("选择结果失败，输入已保留。"),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          按下方理由选择
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {evidence && <Evidence project={project} result={evidence} />}
      <section>
        <h3>人工审阅</h3>
        <label>
          关联计划项
          <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">整个交付</option>
            {items.map((i) => (
              <option key={text(i.planItemId)} value={text(i.planItemId)}>
                {text(i.planItemId)}
              </option>
            ))}
          </select>
        </label>
        <label>
          理由
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>明确复核的拒绝事件</legend>
          {unresolvedEvents.map((e) => (
            <label className="inline" key={text(e.id)}>
              <input
                type="checkbox"
                checked={resolved.includes(text(e.id))}
                onChange={(event) =>
                  setResolved(
                    event.target.checked
                      ? [...resolved, text(e.id)]
                      : resolved.filter((id) => id !== e.id),
                  )
                }
              />
              {text(e.reason)} <code>{text(e.id)}</code>
            </label>
          ))}
        </fieldset>
        <details>
          <summary>风险接受的逐项理由</summary>
          {items.map((i) => (
            <label key={text(i.planItemId)}>
              {text(i.planItemId)}
              <input
                value={risk[text(i.planItemId)] || ""}
                onChange={(e) =>
                  setRisk({ ...risk, [text(i.planItemId)]: e.target.value })
                }
              />
            </label>
          ))}
        </details>
        <div className="actions">
          {(
            [
              "comment",
              "reject_item",
              "resolve_rejection",
              "accept",
              "reject",
              "accept_risk",
              "withdraw",
            ] as const
          ).map((action) => (
            <button
              key={action}
              disabled={
                busy ||
                !valid ||
                (action === "accept" &&
                  (body.readiness !== "ready" ||
                    unresolvedEvents.length > 0)) ||
                (!["comment", "accept"].includes(action) && !reason.trim())
              }
              onClick={() => void review(action)}
            >
              {
                {
                  comment: "评论",
                  reject_item: "拒绝该项",
                  resolve_rejection: "复核拒绝",
                  accept: "接受",
                  reject: "拒绝交付",
                  accept_risk: "按风险接受",
                  withdraw: "撤回决定",
                }[action]
              }
            </button>
          ))}
        </div>
      </section>
      <h3>人审历史</h3>
      <ol>
        {events.map((e) => (
          <li key={text(e.id)}>
            <strong>{text(e.action)}</strong> {text(e.reason)}
            <br />
            <small>
              Snapshot {text(e.snapshotId)} · {text(e.createdAt)}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}
