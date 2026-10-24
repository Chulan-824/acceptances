import { EmptyState } from "./components/reui/empty-state";
import { Frame, FrameHeader, FramePanel } from "./components/reui/frame";
import { useEffect, useRef, useState } from "react";
import {
  request,
  RequestError,
  type BusinessDocument,
  type BusinessGuide,
  type DocumentKind,
  type DeliverySnapshot,
} from "@acceptances/api-client";
import { Load, message, Status, useResource } from "./client";
import { Alert } from "./components/reui/alert";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Disclosure } from "./components/disclosure";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";

export function BusinessDocuments({
  delivery,
}: {
  delivery: DeliverySnapshot;
}) {
  return (
    <>
      <DocumentPanel
        key={delivery.id + "-guide"}
        delivery={delivery}
        kind="business_guide"
      />
      <DocumentPanel
        key={delivery.id + "-report"}
        delivery={delivery}
        kind="test_report"
      />
    </>
  );
}

function DocumentPanel({
  delivery,
  kind,
}: {
  delivery: DeliverySnapshot;
  kind: DocumentKind;
}) {
  const isGuide = kind === "business_guide";
  const label = isGuide ? "业务指南" : "测试报告";
  const [source, setSource] = useState<BusinessGuide>();
  const [sourceName, setSourceName] = useState("");
  const [readingSource, setReadingSource] = useState(false);
  const pendingRetry = useRef<BusinessDocument | undefined>(undefined);
  const [uncertainRequest, setUncertainRequest] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<BusinessDocument>();
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const previewClose = useRef<HTMLButtonElement | null>(null);
  const path = "/deliveries/" + encodeURIComponent(delivery.id) + "/documents";
  const { data, error: loadError } = useResource<{ items: BusinessDocument[] }>(
    path + "?kind=" + kind,
    revision,
    true,
  );
  const generating =
    data?.items.some((item) => item.status === "generating") ?? false;
  useEffect(() => {
    if (!generating) return;
    const interval = window.setInterval(() => setRevision((r) => r + 1), 1500);
    return () => window.clearInterval(interval);
  }, [generating]);
  async function generate(selectedRetry?: BusinessDocument) {
    const retry = selectedRetry ?? pendingRetry.current;
    if (submitting.current || readingSource || delivery.status !== "valid")
      return;
    pendingRetry.current = retry;
    submitting.current = true;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const document = await request<BusinessDocument>(
        retry ? "/documents/" + encodeURIComponent(retry.id) + "/retry" : path,
        "POST",
        retry
          ? {}
          : {
              requestId: requestId.current,
              kind,
              ...(isGuide && source ? { guide: source } : {}),
            },
      );
      requestId.current = null;
      setUncertainRequest(false);
      pendingRetry.current = undefined;
      setRevision((r) => r + 1);
      if (document.status === "failed") setError(document.error);
    } catch (failure) {
      const uncertain =
        failure instanceof RequestError &&
        (failure.phase !== "response" ||
          failure.code === "DOCUMENT_GENERATING");
      setError(
        uncertain
          ? "生成结果未知，请刷新文档列表；再次生成会使用原提交标识，确认结果后才能更换指南素材。" +
              message(failure)
          : message(failure),
      );
      setUncertainRequest(uncertain);
      if (!uncertain) {
        requestId.current = null;
        pendingRetry.current = undefined;
      }
      setRevision((r) => r + 1);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <Frame asChild spacing="none">
      <section className="business-documents bg-surface px-6">
        <FrameHeader className="section-heading">
          <h2>{label}</h2>
          <div className="actions">
            <Button
              disabled={
                !data ||
                !!loadError ||
                busy ||
                readingSource ||
                generating ||
                delivery.status !== "valid"
              }
              onClick={() => void generate()}
            >
              {busy
                ? "正在生成…"
                : uncertainRequest
                  ? "确认上次生成结果"
                  : data?.items.some((item) => item.status === "succeeded")
                    ? `生成新版${label}`
                    : `生成${label}`}
            </Button>
            <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
              刷新{label}状态
            </Button>
          </div>
        </FrameHeader>
        <p className="muted">
          {isGuide
            ? "面向业务人员，按模块、页面入口、操作步骤和截图说明功能，可查看状态样例并对照业务确认清单。"
            : "按测试结论、范围覆盖、环境方法、逐项结果、问题复验、人工评审和技术附录生成，分别呈现原始结果与人工决定。新生成的报告使用此结构，已有版本保持原样。"}
          两类文档分别生成和保存版本，均可预览、下载离线 HTML。
        </p>
        {isGuide && delivery.status === "valid" && (
          <Disclosure className="guide-materials" title="整理或更新指南内容">
            <p className="muted">
              首次生成使用已有说明素材；再次生成沿用最近成功的指南内容。可下载素材，补充页面入口、状态含义和截图标注后导入。图片须来自当前交付，样例须明确标为演示数据。
            </p>
            <a
              href={
                "/api/v1" +
                "/deliveries/" +
                encodeURIComponent(delivery.id) +
                "/business-guide-materials"
              }
            >
              下载当前指南素材 JSON
            </a>
            <Label className="field">
              导入指南素材 JSON
              <Input
                type="file"
                accept=".json,application/json"
                disabled={
                  busy || readingSource || generating || uncertainRequest
                }
                onChange={async (event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  setError("");
                  setReadingSource(true);
                  try {
                    if (file.size > 1024 * 1024)
                      throw new Error("指南素材不能超过 1 MiB。");
                    const value: unknown = JSON.parse(await file.text());
                    if (
                      !value ||
                      typeof value !== "object" ||
                      !("schemaVersion" in value) ||
                      value.schemaVersion !== 1
                    )
                      throw new Error(
                        "请导入 schemaVersion 为 1 的指南素材 JSON。",
                      );
                    setSource(value as BusinessGuide);
                    setSourceName(file.name);
                    requestId.current = null;
                  } catch (failure) {
                    setError(message(failure));
                  } finally {
                    setReadingSource(false);
                  }
                }}
              />
            </Label>
            {sourceName && (
              <p role="status">
                待生成素材：{sourceName}。点击“生成{label}”后保存为新版本。
              </p>
            )}
          </Disclosure>
        )}
        {delivery.status !== "valid" && (
          <p>交付已非有效状态，停止新生成；已有文档仍可作为历史预览与下载。</p>
        )}
        {error && (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        )}
        {loadError && (
          <Alert variant="destructive" role="alert">
            {loadError}
          </Alert>
        )}
        {!data ? (
          <Load error={loadError} />
        ) : data.items.length ? (
          <ul className="document-versions">
            {data.items.map((document) => (
              <FramePanel key={document.id} asChild variant="divider">
                <li>
                  <div className="section-heading">
                    <p>
                      {label} v{document.version} ·{" "}
                      <Status value={document.status} context="document" /> ·
                      尝试 {document.attempts} 次
                    </p>
                    {document.status === "succeeded" && (
                      <div className="actions">
                        <Button
                          variant="outline"
                          onClick={(event) => {
                            previewTrigger.current = event.currentTarget;
                            setPreview(document);
                          }}
                        >
                          预览{label} v{document.version}
                        </Button>
                        <a
                          href={
                            "/api/v1/documents/" +
                            encodeURIComponent(document.id) +
                            "/html?download=1"
                          }
                        >
                          下载{label} HTML v{document.version}
                        </a>
                      </div>
                    )}
                    {document.status === "failed" && (
                      <Button
                        disabled={
                          busy ||
                          readingSource ||
                          generating ||
                          uncertainRequest ||
                          delivery.status !== "valid"
                        }
                        onClick={() => void generate(document)}
                      >
                        重试{label} v{document.version}
                      </Button>
                    )}
                  </div>
                  {document.error && <p role="alert">{document.error}</p>}
                  {document.sha256 && (
                    <p className="muted">
                      成品摘要：<code>{document.sha256}</code>
                    </p>
                  )}
                </li>
              </FramePanel>
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            title={`尚未生成${label}`}
            description={
              delivery.status === "valid"
                ? `可在上方生成${label}，已有版本会保留。`
                : `该交付当前非有效状态，不能生成新${label}。`
            }
          />
        )}
        <Dialog
          open={Boolean(preview)}
          onOpenChange={(open) => {
            if (!open) setPreview(undefined);
          }}
        >
          <DialogContent
            className="business-preview"
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              previewClose.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              previewTrigger.current?.focus();
            }}
          >
            <div className="section-heading">
              <DialogTitle>
                {label} v{preview?.version}
              </DialogTitle>
              <Button ref={previewClose} onClick={() => setPreview(undefined)}>
                关闭预览
              </Button>
            </div>
            <DialogDescription>
              {delivery.status === "valid"
                ? `本${label}对应此交付，下载文件可离线阅读。`
                : `历史${label}，关联交付当前已非有效状态。`}
            </DialogDescription>
            {preview && (
              <iframe
                title={`${label}预览`}
                sandbox=""
                src={
                  "/api/v1/documents/" +
                  encodeURIComponent(preview.id) +
                  "/html"
                }
              />
            )}
          </DialogContent>
        </Dialog>
      </section>
    </Frame>
  );
}
