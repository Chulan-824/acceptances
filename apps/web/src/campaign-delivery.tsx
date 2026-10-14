import { useCampaignRun } from "./campaign-run";
import {
  describeCampaignDelivery,
  deliveryIssueAction,
} from "./campaign-delivery-model";
import { Button } from "./components/ui/button";
import { Alert } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Status } from "./client";

export function CampaignDelivery({
  navigate,
}: {
  navigate: (path: string) => void;
}) {
  const { view, actions } = useCampaignRun();
  const state = view.delivery;
  const data = state.data;
  const loading = state.status === "loading" || state.status === "refreshing";
  const presentation = data ? describeCampaignDelivery(data) : undefined;
  const prep = data?.preparation;
  const snapshot = data?.currentDelivery ?? data?.latestDelivery;
  const busy =
    view.operation?.phase === "submitting" ||
    view.operation?.phase === "checking";
  const fresh = state.status === "ready" && !busy;
  return (
    <section className="campaign-delivery" aria-label="需求交付">
      <div className="section-heading">
        <h2>需求交付</h2>
        {presentation && (
          <Badge className={"badge " + (snapshot?.status ?? "pending")}>
            {presentation.label}
          </Badge>
        )}
      </div>
      {state.error && (
        <Alert variant="destructive" role="alert">
          交付状态读取失败，暂不能确认最新准备条件。{state.error}
          <Button variant="outline" onClick={() => void actions.refresh()}>
            重试读取
          </Button>
        </Alert>
      )}
      {loading && <p role="status">正在检查交付准备…</p>}
      {!data && !loading && !state.error && <p>交付状态尚未读取。</p>}
      {data && presentation && (
        <>
          <ol className="delivery-progress" aria-label="需求交付进度">
            <li>
              <strong>完整范围评审</strong>
              <p>{presentation.review}</p>
            </li>
            <li>
              <strong>确认需求交付</strong>
              <p>
                {snapshot ? (
                  <>
                    交付 v{snapshot.version} ·{" "}
                    <Status value={snapshot.status} />
                  </>
                ) : (
                  "尚未确认需求交付"
                )}
              </p>
            </li>
            <li>
              <strong>业务说明</strong>
              <p>
                {snapshot ? (
                  <>
                    交付 v{snapshot.version}：{presentation.document}
                  </>
                ) : (
                  "确认交付后可生成"
                )}
              </p>
            </li>
          </ol>
          {data.currentDelivery && !presentation.sameRun && (
            <p className="delivery-notice">
              当前有效交付 v{data.currentDelivery.version} 来源于历史验证记录。
              {prep
                ? "最新一轮独立评审，确认新的交付后才替代旧版本。"
                : "当前没有最新报告，历史交付及说明仍独立保留。"}
            </p>
          )}
          {!prep && (
            <p>
              暂无最新验证记录。请在业务目录开展实际验证并提交报告；历史报告不会自动成为最终交付来源。
            </p>
          )}
          {prep && !presentation.sameRun && (
            <div className="delivery-readiness">
              <strong>
                {fresh
                  ? presentation.next
                  : "以下为上次读取的准备条件，需刷新后确认"}
              </strong>
              {prep.issues.length > 0 ? (
                <ul aria-label="交付阻塞原因">
                  {prep.issues.map((issue) => (
                    <li key={issue.code}>
                      <p>{issue.message}</p>
                      <p className="muted">
                        下一步：{deliveryIssueAction(issue.code)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  准备条件已满足。请审阅范围、版本、业务素材与例外接受理由，再明确确认交付。
                </p>
              )}
            </div>
          )}
          <div className="actions">
            {prep && (
              <Button
                variant={
                  fresh && prep.eligible && !presentation.sameRun
                    ? "default"
                    : "outline"
                }
                onClick={() =>
                  navigate("/deliveries/new/" + encodeURIComponent(prep.runId))
                }
              >
                {fresh && prep.eligible && !presentation.sameRun
                  ? "确认需求交付"
                  : "查看交付准备"}
              </Button>
            )}
            {snapshot && (
              <Button
                variant="outline"
                onClick={() => navigate("/deliveries/" + snapshot.id)}
              >
                查看交付与业务说明
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate("/deliveries")}>
              交付版本
            </Button>
          </div>
          <p className="muted">
            本轮人工验收与需求交付分别记录。确认交付会保存版本、范围、人工判断和证据副本；业务说明需在交付详情中生成。
          </p>
        </>
      )}
    </section>
  );
}
