import { useEffect, useRef, useState } from "react";
import {
  request,
  RequestError,
  type BusinessDocument,
  type DeliverySnapshot,
} from "@acceptances/api-client";
import { Load, message, Status, useResource } from "./client";
import { Alert } from "./components/ui/alert";
import { Button } from "./components/ui/button";
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
    path,
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
  async function generate(retry?: BusinessDocument) {
    if (submitting.current || delivery.status !== "valid") return;
    submitting.current = true;
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const document = await request<BusinessDocument>(
        retry ? "/documents/" + encodeURIComponent(retry.id) + "/retry" : path,
        "POST",
        retry ? {} : { requestId: requestId.current },
      );
      requestId.current = null;
      setRevision((r) => r + 1);
      if (document.status === "failed") setError(document.error);
    } catch (failure) {
      const uncertain =
        failure instanceof RequestError && failure.phase !== "response";
      setError(
        uncertain
          ? "生成结果未知，请刷新说明列表；再次生成会使用原提交标识。" +
              message(failure)
          : message(failure),
      );
      if (!uncertain) requestId.current = null;
      setRevision((r) => r + 1);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="business-documents">
      <div className="section-heading">
        <h2>业务说明</h2>
        <div className="actions">
          <Button
            disabled={busy || generating || delivery.status !== "valid"}
            onClick={() => void generate()}
          >
            {busy
              ? "正在生成…"
              : data?.items.some((item) => item.status === "succeeded")
                ? "生成新的说明版本"
                : "生成业务说明"}
          </Button>
          <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
            刷新说明状态
          </Button>
        </div>
      </div>
      <p className="muted">
        根据冻结材料确定性生成，不调用 LLM。HTML
        内嵌图片，可离线阅读。生成不修改验证记录或交付快照。
      </p>
      {delivery.status !== "valid" && (
        <p>交付已非有效状态，停止新生成；已有说明仍可作为历史预览与下载。</p>
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
            <li key={document.id}>
              <div className="section-heading">
                <p>
                  说明 v{document.version} ·{" "}
                  <Status value={document.status} context="document" /> · 尝试{" "}
                  {document.attempts} 次
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
                      预览 v{document.version}
                    </Button>
                    <a
                      href={
                        "/api/v1/documents/" +
                        encodeURIComponent(document.id) +
                        "/html?download=1"
                      }
                    >
                      下载离线 HTML v{document.version}
                    </a>
                  </div>
                )}
                {document.status === "failed" && (
                  <Button
                    disabled={busy || generating || delivery.status !== "valid"}
                    onClick={() => void generate(document)}
                  >
                    重试说明 v{document.version}
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
          ))}
        </ul>
      ) : (
        <p>尚未生成业务说明。</p>
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
            <DialogTitle>业务说明 v{preview?.version}</DialogTitle>
            <Button ref={previewClose} onClick={() => setPreview(undefined)}>
              关闭预览
            </Button>
          </div>
          <DialogDescription>
            {delivery.status === "valid"
              ? "本说明对应此交付的冻结版本。"
              : "历史说明，关联交付当前已非有效状态。"}
          </DialogDescription>
          {preview && (
            <iframe
              title="业务说明预览"
              sandbox=""
              src={
                "/api/v1/documents/" + encodeURIComponent(preview.id) + "/html"
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
