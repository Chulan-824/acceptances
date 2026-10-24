import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { preloadHighlighter, type FileDiffMetadata } from "@pierre/diffs";
import { Button } from "./components/ui/button";
import { Label } from "./components/ui/label";
import { ChoiceSelect } from "./components/choice-select";
import { SelectItem } from "./components/ui/select";
import type { DiffEvidenceData } from "./diff-evidence-data";

export function DiffEvidenceViewer({
  data,
  showRaw,
}: {
  data: DiffEvidenceData;
  showRaw: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const [style, setStyle] = useState<"split" | "unified">(() =>
    window.matchMedia("(min-width: 768px)").matches ? "split" : "unified",
  );
  const file = data.files[selected];
  return (
    <div className="diff-evidence-viewer">
      <div className="diff-evidence-toolbar">
        <span>
          {data.files.length ? `${data.files.length} 个文件` : "差异附件"}
        </span>
        {data.files.length > 0 && (
          <div
            className="diff-evidence-style"
            role="group"
            aria-label="差异展示方式"
          >
            <Button
              size="sm"
              aria-pressed={style === "unified"}
              onClick={() => setStyle("unified")}
            >
              统一
            </Button>
            <Button
              size="sm"
              aria-pressed={style === "split"}
              onClick={() => setStyle("split")}
            >
              并排
            </Button>
          </div>
        )}
      </div>
      {data.warning && (
        <p className="diff-evidence-warning" role="status">
          {data.warning}
        </p>
      )}
      {data.files.length > 0 ? (
        <div className="diff-evidence-body">
          <nav
            className="diff-evidence-files"
            aria-label="变更文件"
            hidden={data.files.length === 1}
          >
            {data.files.map((entry, index) => (
              <Button
                type="button"
                variant="ghost"
                key={index}
                aria-current={selected === index ? "true" : undefined}
                onClick={() => setSelected(index)}
              >
                <span>{entry.name}</span>
                <small>{changeLabel(entry)}</small>
              </Button>
            ))}
          </nav>
          <Label
            className="diff-evidence-file-select"
            hidden={data.files.length === 1}
          >
            变更文件
            <ChoiceSelect
              aria-label="变更文件"
              value={String(selected)}
              onValueChange={(value) => setSelected(Number(value))}
            >
              {data.files.map((entry, index) => (
                <SelectItem key={index} value={String(index)}>
                  {entry.name} · {changeLabel(entry)}
                </SelectItem>
              ))}
            </ChoiceSelect>
          </Label>
          <section
            className="diff-evidence-file"
            aria-label={`文件差异 ${file.name}`}
          >
            <div className="diff-evidence-file-heading">
              <strong>{file.name}</strong>
              <span>{changeLabel(file)}</span>
              {file.prevName && <span>原路径：{file.prevName}</span>}
            </div>
            {file.hunks.length === 0 ? (
              <p className="diff-evidence-message">
                此文件仅有元数据或二进制变更，无法显示逐行差异。请查看原文。
              </p>
            ) : (
              <DiffFile
                key={`${selected}:${style}`}
                file={file}
                style={style}
                showRaw={showRaw}
              />
            )}
          </section>
        </div>
      ) : (
        <div className="diff-evidence-message">
          <p>此附件没有可展示的逐行差异。可查看原文。</p>
        </div>
      )}
    </div>
  );
}

function changeLabel(file: FileDiffMetadata) {
  switch (file.type) {
    case "new":
      return "新增";
    case "deleted":
      return "删除";
    case "rename-pure":
    case "rename-changed":
      return "重命名";
    default:
      return "修改";
  }
}

function DiffFile({
  file,
  style,
  showRaw,
}: {
  file: FileDiffMetadata;
  style: "split" | "unified";
  showRaw: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [initialization, setInitialization] = useState<{
    attempt: number;
    failed: boolean;
  }>();
  useEffect(() => {
    let active = true;
    // Mount FileDiff only after its synchronous rendering baseline is ready.
    // Its cold asynchronous mount can leave an empty pre after StrictMode remount.
    void preloadHighlighter({ themes: ["pierre-light"], langs: ["text"] }).then(
      () => {
        if (active) setInitialization({ attempt, failed: false });
      },
      () => {
        if (active) setInitialization({ attempt, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const options = useMemo(
    () => ({
      diffStyle: style,
      theme: "pierre-light" as const,
      themeType: "light" as const,
      overflow: "scroll" as const,
      disableFileHeader: true,
      disableLineNumbers: false,
      disableErrorHandling: true,
    }),
    [style],
  );
  const failure = (
    <div className="diff-evidence-message" role="alert">
      <p>此文件的差异渲染失败，可重试或查看原文。</p>
      <Button onClick={() => setAttempt(attempt + 1)}>重试渲染</Button>
      <Button variant="outline" onClick={showRaw}>
        查看原文
      </Button>
    </div>
  );
  if (initialization?.attempt !== attempt)
    return (
      <div className="diff-evidence-message" role="status">
        <p>正在准备差异预览…</p>
        <Button variant="outline" onClick={showRaw}>
          查看原文
        </Button>
      </div>
    );
  if (initialization.failed) return failure;
  return (
    <DiffRenderBoundary key={attempt} fallback={failure}>
      <FileDiff fileDiff={file} options={options} />
    </DiffRenderBoundary>
  );
}

class DiffRenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
