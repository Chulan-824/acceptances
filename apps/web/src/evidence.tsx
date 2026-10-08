import { useEffect, useState } from "react";
import {
  api,
  record,
  rows,
  text,
  errorMessage,
  type RecordValue,
} from "./client";
function Asset({ url }: { url: string }) {
  const [content, setContent] = useState("");
  const [objectURL, setURL] = useState("");
  const [mime, setMime] = useState("");
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectURL = "";
    void fetch(url, {
      method: "HEAD",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("资产不可用或无读取权限。");
        const type = response.headers.get("Content-Type") || "";
        setMime(type);
        const unsafe =
          response.headers
            .get("Content-Disposition")
            ?.startsWith("attachment") ?? true;
        setAttachment(unsafe);
        if (unsafe || type.startsWith("audio/") || type.startsWith("video/"))
          return;
        const size = Number(response.headers.get("Content-Length") || 0);
        if (type.startsWith("text/plain") || type === "application/json") {
          const preview = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal,
            headers: { Range: "bytes=0-255999" },
          });
          if (!preview.ok) throw new Error("证据预览不可用。");
          const value = await preview.text();
          setContent(
            size > 256000 ? `${value}\n展示已截断，请下载完整文件。` : value,
          );
        } else if (type.startsWith("image/")) {
          if (size > 16 * 1024 * 1024) {
            setAttachment(true);
            return;
          }
          const image = await fetch(url, {
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!image.ok) throw new Error("图片证据不可用。");
          const blob = await image.blob();
          if (controller.signal.aborted) return;
          objectURL = URL.createObjectURL(blob);
          setURL(objectURL);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => {
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [url]);
  if (error) return <p className="error">{error}</p>;
  if (attachment)
    return (
      <a href={url} download>
        下载附件
      </a>
    );
  if (mime.startsWith("image/")) return <img src={objectURL} alt="验收证据" />;
  if (mime.startsWith("video/")) return <video controls src={url} />;
  if (mime.startsWith("audio/")) return <audio controls src={url} />;
  return <pre>{content}</pre>;
}
export function Evidence({
  project,
  result,
}: {
  project: string;
  result: RecordValue;
}) {
  const [report, setReport] = useState<RecordValue>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/projects/{projectId}/runs/{runId}/revisions/{revisionId}", {
        params: {
          path: {
            projectId: project,
            runId: text(result.runId),
            revisionId: text(result.revisionId),
          },
        },
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(errorMessage(error));
        else if (data) setReport(record(data.data));
      })
      .catch(() => {
        if (active) setError("报告无法读取。");
      });
    return () => {
      active = false;
    };
  }, [project, result]);
  return (
    <section>
      <h3>固定修订证据</h3>
      <p>
        Run {text(result.runId)}
        <br />
        Revision {text(result.revisionId)}
        <br />
        封存状态 {text(report.phase)}
        <br />
        摘要 <code>{text(report.sealDigest)}</code>
      </p>
      {error && <p role="alert">{error}</p>}
      {rows(record(report.report).results)
        .filter((r) => !result.resultId || r.id === result.resultId)
        .map((r) => (
          <div key={text(r.id)}>
            <p>执行结果 {text(r.outcome)}</p>
            {rows(r.attempts).map((a) => (
              <article key={text(a.id)}>
                <h4>
                  Attempt {String(a.ordinal)} · {text(a.outcome)}
                </h4>
                {rows(a.observations).map((o, i) => (
                  <div key={i}>
                    <p>
                      {text(o.actual)} · {text(o.verdict)}
                    </p>
                    {rows(o.evidence).map((e) => (
                      <figure key={text(e.assetId)}>
                        <figcaption>{text(e.description)}</figcaption>
                        <Asset
                          url={`/api/v1/projects/${project}/revisions/${text(result.revisionId)}/assets/${text(e.assetId)}/content`}
                        />
                      </figure>
                    ))}
                  </div>
                ))}
              </article>
            ))}
          </div>
        ))}
    </section>
  );
}
