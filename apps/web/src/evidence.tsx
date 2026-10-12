import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Disclosure } from "./components/disclosure";
import { Button } from "./components/ui/button";
import { useRef, useState } from "react";
import { TextEvidence } from "./text-evidence";
import { Icon } from "./workspace-controls";
import {
  evidenceURL,
  type Evidence as EvidenceData,
} from "@acceptances/api-client";
export function Evidence({
  run,
  item,
  inline = false,
  gallery = false,
}: {
  run: string;
  item: EvidenceData;
  inline?: boolean;
  gallery?: boolean;
}) {
  const url = evidenceURL(run, item.path);
  const extension = item.path.split(".").pop()?.toLowerCase();
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [textExpanded, setTextExpanded] = useState(false);
  const [preview, setPreview] = useState(false);
  const [imageError, setImageError] = useState(false);
  return (
    <figure
      className={`evidence${inline ? " inline-preview" : ""}${gallery ? " gallery-evidence" : ""}`}
      id={inline ? undefined : `evidence-${item.path}`}
    >
      <figcaption>
        <strong>{item.path}</strong>
        <span>{item.description}</span>
      </figcaption>
      {["png", "jpg", "jpeg", "gif", "webp"].includes(extension || "") ? (
        <>
          <Button
            className="image-preview"
            ref={previewTrigger}
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
          </Button>
          <Dialog open={preview} onOpenChange={setPreview}>
            <DialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                previewTrigger.current?.focus();
              }}
              className="evidence-dialog"
              showCloseButton={false}
            >
              <DialogDescription className="sr-only">
                查看图片证据，或打开原文件与下载附件。
              </DialogDescription>
              <>
                <div className="section-heading">
                  <DialogTitle>{item.description || item.path}</DialogTitle>
                  <Button autoFocus onClick={() => setPreview(false)}>
                    关闭预览
                  </Button>
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
            </DialogContent>
          </Dialog>
        </>
      ) : ["mp4", "webm", "ogg"].includes(extension || "") ? (
        <video controls preload="metadata" src={url} />
      ) : ["txt", "log", "json", "csv"].includes(extension || "") ? (
        <Disclosure
          className="text-evidence-disclosure"
          open={textExpanded}
          onOpenChange={setTextExpanded}
          title={
            <>
              <Icon name="file" />
              <span>{item.path}</span>
              <Icon name="chevron" />
            </>
          }
        >
          {textExpanded && <TextEvidence url={url} />}
        </Disclosure>
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
