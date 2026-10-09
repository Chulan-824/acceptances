import {
  evidenceURL,
  type Evidence as EvidenceData,
} from "@acceptances/api-client";
export function Evidence({ run, item }: { run: string; item: EvidenceData }) {
  const url = evidenceURL(run, item.path);
  const extension = item.path.split(".").pop()?.toLowerCase();
  return (
    <figure id={`evidence-${item.path}`}>
      <figcaption>
        <strong>{item.path}</strong> {item.description}
      </figcaption>
      {["png", "jpg", "jpeg", "gif", "webp"].includes(extension || "") ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img loading="lazy" src={url} alt={item.description || item.path} />
        </a>
      ) : ["mp4", "webm", "ogg"].includes(extension || "") ? (
        <video controls preload="metadata" src={url} />
      ) : ["txt", "log", "json", "csv"].includes(extension || "") ? (
        <iframe sandbox="" title={item.description || item.path} src={url} />
      ) : (
        <p>此附件仅提供下载。</p>
      )}
      <a href={evidenceURL(run, item.path, true)} download>
        下载附件
      </a>
    </figure>
  );
}
