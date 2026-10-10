import { useEffect, useId, useRef, useState } from "react";
import { TextEvidence } from "./text-evidence";
import {
  evidenceURL,
  type Evidence as EvidenceData,
} from "@acceptances/api-client";
export function Evidence({
  run,
  item,
  inline = false,
}: {
  run: string;
  item: EvidenceData;
  inline?: boolean;
}) {
  const url = evidenceURL(run, item.path);
  const extension = item.path.split(".").pop()?.toLowerCase();
  const [preview, setPreview] = useState(false);
  const [imageError, setImageError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (preview) dialog.current?.showModal();
    else dialog.current?.close();
  }, [preview]);
  return (
    <figure
      className={inline ? "evidence inline-preview" : "evidence"}
      id={inline ? undefined : `evidence-${item.path}`}
    >
      <figcaption>
        <strong>{item.path}</strong>
        <span>{item.description}</span>
      </figcaption>
      {["png", "jpg", "jpeg", "gif", "webp"].includes(extension || "") ? (
        <>
          <button
            className="image-preview"
            aria-label={`放大预览 ${item.path}`}
            onClick={() => setPreview(true)}
          >
            <img
              loading={inline ? "eager" : "lazy"}
              src={url}
              alt={item.description || item.path}
              onError={() => setImageError(true)}
            />
            <span>
              {imageError ? "图片加载失败，可尝试打开原文件" : "放大预览"}
            </span>
          </button>
          <dialog
            ref={dialog}
            className="evidence-dialog"
            aria-labelledby={titleId}
            onCancel={() => setPreview(false)}
            onClose={() => setPreview(false)}
          >
            {preview && (
              <>
                <div className="section-heading">
                  <h2 id={titleId}>{item.description || item.path}</h2>
                  <button autoFocus onClick={() => setPreview(false)}>
                    关闭预览
                  </button>
                </div>
                <img src={url} alt={item.description || item.path} />
                <div className="actions">
                  <a href={url} target="_blank" rel="noreferrer">
                    打开原文件
                  </a>
                  <a href={evidenceURL(run, item.path, true)} download>
                    下载附件
                  </a>
                </div>
              </>
            )}
          </dialog>
        </>
      ) : ["mp4", "webm", "ogg"].includes(extension || "") ? (
        <video controls preload="metadata" src={url} />
      ) : ["txt", "log", "json", "csv"].includes(extension || "") ? (
        <TextEvidence url={url} />
      ) : (
        <p>此附件仅提供下载。</p>
      )}
      <div className="actions">
        <a href={url} target="_blank" rel="noreferrer">
          打开原文件
        </a>
        <a href={evidenceURL(run, item.path, true)} download>
          下载附件
        </a>
      </div>
    </figure>
  );
}
