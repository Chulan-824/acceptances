import { useEffect, useState } from "react";
import type { DeliverySummary, Run } from "@acceptances/api-client";
import { message, request, Status } from "./client";
import { Button } from "./components/ui/button";

export function CampaignDelivery({
  run,
  isLatest,
  busy,
  navigate,
}: {
  run: Run;
  isLatest: boolean;
  busy: boolean;
  navigate: (path: string) => void;
}) {
  const [state, setState] = useState<{
    items?: DeliverySummary[];
    error?: string;
  }>({});
  useEffect(() => {
    let active = true;
    void request<{ items: DeliverySummary[] }>(
      "/deliveries?campaignId=" + encodeURIComponent(run.campaignId),
    )
      .then(({ items }) => {
        if (active) setState({ items });
      })
      .catch((error) => {
        if (active) setState({ error: message(error) });
      });
    return () => {
      active = false;
    };
  }, [run, isLatest]);
  const snapshot = state.items?.[0];
  return (
    <section className="campaign-delivery" aria-label="正式交付版本">
      <div>
        <strong>正式交付</strong>{" "}
        {state.error ? (
          <span>归档读取失败：{state.error}</span>
        ) : !state.items ? (
          <span>正在读取冻结版本…</span>
        ) : snapshot ? (
          <>
            <span>v{snapshot.version}</span> <Status value={snapshot.status} />
            <p className="muted">
              {snapshot.runId === run.id
                ? "来源为当前展示的验证记录。"
                : isLatest
                  ? "来源为历史验证记录，当前最新一轮另行审核。"
                  : "来源为其他验证记录。"}
              人工通过与正式冻结分别记录。
            </p>
          </>
        ) : (
          <span>尚未冻结；人工通过后仍需明确确认。</span>
        )}
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          navigate(snapshot ? "/deliveries/" + snapshot.id : "/deliveries")
        }
      >
        {snapshot ? "查看冻结版本与业务说明" : "查看交付归档"}
      </Button>
    </section>
  );
}
