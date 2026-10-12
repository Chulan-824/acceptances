import { Disclosure } from "./components/disclosure";
import { useState } from "react";
import { EvidenceImage } from "./evidence-image";
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
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(
    extension || "",
  );
  const [textExpanded, setTextExpanded] = useState(false);
  return (
    <figure
      className={`evidence${inline ? " inline-preview" : ""}${gallery ? " gallery-evidence" : ""}`}
      id={inline ? undefined : `evidence-${item.path}`}
    >
      {!isImage && (
        <figcaption>
          <strong>{item.path}</strong>
          <span>{item.description}</span>
        </figcaption>
      )}
      {isImage ? (
        <EvidenceImage
          url={url}
          description={item.description || item.path}
          label={`放大预览 ${item.path}`}
          eager={inline}
        />
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
        <p>此附件格式暂不支持预览。</p>
      )}
    </figure>
  );
}
