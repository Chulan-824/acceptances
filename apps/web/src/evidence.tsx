import { FramePanel } from "./components/reui/frame";
import { FileType, getFileType } from "./components/reui/file-type";
import { EvidenceImage } from "./evidence-image";
import { FilePreview, isDocumentEvidence } from "./file-preview";
import type { PreviewResource } from "./file-preview-formats";
import {
  evidenceURL,
  type Evidence as EvidenceData,
} from "@acceptances/api-client";

export function isImageEvidence(path: string) {
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(
    path.split(".").pop()?.toLowerCase() || "",
  );
}

export function Evidence({
  run,
  item,
  inline = false,
  gallery = false,
  resources = [],
}: {
  run: string;
  item: EvidenceData;
  inline?: boolean;
  gallery?: boolean;
  resources?: EvidenceData[];
}) {
  const url = evidenceURL(run, item.path);
  const isImage = isImageEvidence(item.path);
  return (
    <FramePanel
      asChild
      variant="outline"
      className={gallery ? "bg-transparent p-3" : "bg-transparent"}
    >
      <figure
        className={`evidence${inline ? " inline-preview" : ""}${gallery ? " gallery-evidence" : ""}`}
        id={inline ? undefined : `evidence-${item.path}`}
      >
        {!isImage && (
          <figcaption>
            <strong className="evidence-file-name">
              <FileType
                type={getFileType(item.path)}
                variant="mono"
                aria-hidden="true"
              />
              {item.path}
            </strong>
            <span>{item.description}</span>
          </figcaption>
        )}
        <EvidenceContent
          url={url}
          name={item.path}
          description={item.description}
          eager={inline}
          resources={resources.map((resource) => ({
            path: resource.path,
            url: evidenceURL(run, resource.path),
          }))}
        />
      </figure>
    </FramePanel>
  );
}

export function EvidenceContent({
  url,
  name,
  description,
  resources = [],
  eager = false,
}: {
  url: string;
  name: string;
  description?: string;
  resources?: PreviewResource[];
  eager?: boolean;
}) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (isImageEvidence(name))
    return (
      <EvidenceImage
        url={url}
        description={description || name}
        label={`放大预览 ${name}`}
        eager={eager}
      />
    );
  if (["mp4", "webm", "ogg"].includes(extension || ""))
    return <video controls preload="metadata" src={url} />;
  if (isDocumentEvidence(name))
    return (
      <FilePreview
        url={url}
        name={name}
        description={description}
        resources={resources}
      />
    );
  return <p>此附件格式暂不支持预览。</p>;
}
