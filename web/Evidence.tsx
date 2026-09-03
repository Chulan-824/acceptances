import { useEffect, useRef, useState } from "react";

import { url } from "./api";
import type { Comparison, Evidence as EvidenceValue } from "./types";

function evidenceName(item: EvidenceValue) {
  const raw = typeof item === "string" ? item : item.path;
  return String(raw || "").replace(/^assets\//, "");
}

function prettyText(name: string, raw: string) {
  if (!name.toLowerCase().endsWith(".json")) return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Media({
  name,
  source,
  text,
  onPreview,
}: {
  name: string;
  source: string;
  text?: string;
  onPreview: (source: string) => void;
}) {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(lower)) {
    return (
      <button className="image-strip" type="button" onClick={() => onPreview(source)}>
        <img alt={name} loading="lazy" src={source} />
        <span>查看原图</span>
      </button>
    );
  }
  if (/\.(mp4|webm)$/.test(lower)) return <video controls preload="metadata" src={source} />;
  if (/\.(mp3|wav|ogg)$/.test(lower)) return <audio controls preload="metadata" src={source} />;
  if (text !== undefined) {
    if (/\.json$/i.test(name)) {
      return (
        <details className="raw-evidence">
          <summary>
            <span>查看原始 JSON</span>
            <code>{name}</code>
          </summary>
          <pre>{prettyText(name, text)}</pre>
        </details>
      );
    }
    return <pre>{text}</pre>;
  }
  return <a href={source} target="_blank" rel="noreferrer">{name}</a>;
}

interface EvidenceRecord {
  name: string;
  comparison?: Comparison;
}

function groupEvidence(evidence: EvidenceValue[]) {
  const singles: EvidenceRecord[] = [];
  const pairs = new Map<string, { layout: string; before?: EvidenceRecord; after?: EvidenceRecord }>();
  for (const item of evidence) {
    const record = {
      name: evidenceName(item),
      comparison: typeof item === "string" ? undefined : item.comparison,
    };
    if (!record.comparison?.id) {
      singles.push(record);
      continue;
    }
    const pair = pairs.get(record.comparison.id) || {
      layout: record.comparison.layout || "horizontal",
    };
    pair[record.comparison.role] = record;
    pairs.set(record.comparison.id, pair);
  }
  return { singles, pairs: [...pairs.values()] };
}

export function Evidence({
  evidence = [],
  evidenceTexts,
  root,
  subject,
  round,
}: {
  evidence?: EvidenceValue[];
  evidenceTexts: Record<string, string>;
  root: string;
  subject: string;
  round: string;
}) {
  const [preview, setPreview] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const grouped = groupEvidence(evidence);

  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal();
  }, [preview]);

  function source(name: string) {
    return url("/api/asset", { root, subject, round, name });
  }

  function figure(record: EvidenceRecord, role?: "before" | "after") {
    const label = record.comparison?.label || role || record.name;
    return (
      <figure className={role || ""} key={`${role || "single"}-${record.name}`}>
        <Media
          name={record.name}
          onPreview={setPreview}
          source={source(record.name)}
          text={evidenceTexts[record.name]}
        />
        <figcaption>{label}</figcaption>
      </figure>
    );
  }

  if (!evidence.length) return <p className="muted">无证据</p>;
  return (
    <>
      <div className="evidence">
        {grouped.pairs.map((pair, index) => (
          <div className={`comparison ${pair.layout}`} key={index}>
            {pair.before ? figure(pair.before, "before") : <div className="muted">缺少 before</div>}
            {pair.after ? figure(pair.after, "after") : <div className="muted">缺少 after</div>}
          </div>
        ))}
        {grouped.singles.map((record) => figure(record))}
      </div>
      <dialog
        className="image-dialog"
        ref={dialog}
        onClose={() => setPreview("")}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <button type="button" aria-label="关闭原图" onClick={() => dialog.current?.close()}>×</button>
        {preview ? <img alt="证据原图" src={preview} /> : null}
      </dialog>
    </>
  );
}
