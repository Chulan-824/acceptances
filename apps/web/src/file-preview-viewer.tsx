import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table";
import { parseDiffEvidence } from "./diff-evidence-data";
import {
  loadFilePreview,
  PREVIEW_PAGE_BYTES,
  readPreviewPage,
  richPreviewWarning,
  type PreviewPage,
} from "./file-preview-data";
import {
  formatPreviewJSON,
  parsePreviewCSV,
  resolvePreviewImage,
} from "./file-preview-formats";
import type { FilePreviewProps } from "./file-preview";
import { createPreviewModuleLoader } from "./preview-module-loader";

type LoadedPreview = Awaited<ReturnType<typeof loadFilePreview>>;
const loadDiffViewer = createPreviewModuleLoader(
  () => import("./diff-evidence-viewer"),
  "diff-evidence-viewer",
);

function DiffViewerLoader(
  props: Parameters<
    typeof import("./diff-evidence-viewer").DiffEvidenceViewer
  >[0],
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    module?: Awaited<ReturnType<typeof loadDiffViewer>>;
  }>();
  useEffect(() => {
    let active = true;
    void loadDiffViewer().then(
      (module) => {
        if (active) setResult({ attempt, module });
      },
      () => {
        if (active) setResult({ attempt });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (result?.attempt !== attempt)
    return (
      <p className="diff-evidence-message" role="status">
        正在加载差异预览…
      </p>
    );
  if (result.module) return <result.module.DiffEvidenceViewer {...props} />;
  return (
    <div className="diff-evidence-message" role="alert">
      <p>
        差异预览组件加载失败，请重试。若仍然失败，请保存当前输入后刷新页面。
      </p>
      <Button onClick={() => setAttempt((value) => value + 1)}>
        重试加载差异预览
      </Button>
      <Button variant="outline" onClick={props.showRaw}>
        查看原文
      </Button>
    </div>
  );
}

export function FilePreviewViewer(props: FilePreviewProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LoadedFile
      key={`${props.url}:${attempt}`}
      {...props}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}

function LoadedFile({
  retry,
  ...props
}: FilePreviewProps & { retry: () => void }) {
  const [result, setResult] = useState<
    { data: LoadedPreview } | { error: string }
  >();
  const extension = props.name.split(".").pop()?.toLowerCase() || "txt";
  useEffect(() => {
    const controller = new AbortController();
    void loadFilePreview(
      props.url,
      !["txt", "log"].includes(extension),
      controller.signal,
    ).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            error: error instanceof Error ? error.message : "附件加载失败。",
          });
      },
    );
    return () => controller.abort();
  }, [props.url, extension]);
  if (!result)
    return (
      <p className="diff-evidence-message" role="status">
        正在读取文件…
      </p>
    );
  if ("error" in result)
    return (
      <div className="diff-evidence-message" role="alert">
        <p>{result.error}</p>
        <Button onClick={retry}>重试读取文件</Button>
      </div>
    );
  return <FileContents {...props} extension={extension} data={result.data} />;
}

function FileContents({
  data,
  extension,
  ...props
}: FilePreviewProps & { data: LoadedPreview; extension: string }) {
  const rich = useMemo(() => {
    if (data.text === undefined || !data.text) return {};
    try {
      if (extension === "json") {
        const json = formatPreviewJSON(data.text);
        const warning = richPreviewWarning(json);
        return warning ? { error: warning } : { json };
      }
      if (extension === "csv") return { rows: parsePreviewCSV(data.text) };
      if (["diff", "patch"].includes(extension)) {
        const diff = parseDiffEvidence(data.text);
        return diff.files.length ? { diff } : { error: diff.warning };
      }
      if (
        data.text.length > 512 * 1024 ||
        (data.text.match(/[|*_`[\]]/g)?.length || 0) > 20_000
      )
        return {
          error: "文档长度或排版复杂度超过预览范围，已切换为分段原文。",
        };
      return { markdown: true };
    } catch (error) {
      return {
        error:
          extension === "json" && error instanceof SyntaxError
            ? "JSON 格式不正确，已切换为原文。"
            : error instanceof Error
              ? error.message + " 已切换为原文。"
              : "无法排版，请查看原文。",
      };
    }
  }, [data.text, extension]);
  const hasRich = Boolean(
    rich.json !== undefined || rich.rows || rich.diff || rich.markdown,
  );
  const [raw, setRaw] = useState(!hasRich);
  const [wrap, setWrap] = useState(extension === "txt");
  const [header, setHeader] = useState(false);
  const label = rich.diff
    ? "差异"
    : extension === "json"
      ? "格式化"
      : extension === "csv"
        ? "表格"
        : "预览";
  const warning = data.warning || rich.error;
  return (
    <div className="file-preview-viewer">
      <div className="file-preview-toolbar">
        {hasRich && (
          <div role="group" aria-label="文件展示方式">
            <Button size="sm" aria-pressed={!raw} onClick={() => setRaw(false)}>
              {label}
            </Button>
            <Button size="sm" aria-pressed={raw} onClick={() => setRaw(true)}>
              原文
            </Button>
          </div>
        )}
        {(raw || rich.json !== undefined) && (
          <Button
            size="sm"
            variant="outline"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            自动换行
          </Button>
        )}
        {!raw && rich.rows && (
          <Button
            size="sm"
            variant="outline"
            aria-pressed={header}
            onClick={() => setHeader(!header)}
          >
            首行作为表头
          </Button>
        )}
        <span className="muted">{data.page.total.toLocaleString()} 字节</span>
      </div>
      {warning && (
        <p className="file-preview-notice" role="status">
          {warning}
        </p>
      )}
      {hasRich && (
        <div
          className={`file-preview-rich${rich.diff ? " file-preview-is-diff" : ""}`}
          hidden={raw}
        >
          <PreviewBoundary
            fallback={
              <div className="diff-evidence-message" role="alert">
                <p>文件排版失败，请查看原文。</p>
                <Button onClick={() => setRaw(true)}>查看原文</Button>
              </div>
            }
          >
            {rich.markdown && (
              <article className="file-preview-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    table: ({ children }) => <Table>{children}</Table>,
                    thead: ({ children }) => (
                      <TableHeader>{children}</TableHeader>
                    ),
                    tbody: ({ children }) => <TableBody>{children}</TableBody>,
                    tr: ({ children }) => <TableRow>{children}</TableRow>,
                    th: ({ children, style }) => (
                      <TableHead className="whitespace-normal" style={style}>
                        {children}
                      </TableHead>
                    ),
                    td: ({ children, style }) => (
                      <TableCell className="whitespace-pre-wrap" style={style}>
                        {children}
                      </TableCell>
                    ),
                    input: ({ checked, disabled }) => (
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        aria-label="任务完成状态"
                      />
                    ),
                    img: ({ src, alt }) => {
                      const url = resolvePreviewImage(
                        typeof src === "string" ? src : undefined,
                        props.resources || [],
                      );
                      return url ? (
                        <img src={url} alt={alt || "归档图片"} loading="lazy" />
                      ) : (
                        <span className="file-preview-missing-image">
                          图片不可用：{alt || src || "未提供路径"}
                        </span>
                      );
                    },
                    a: ({ href, children }) =>
                      href && /^https?:\/\//i.test(href) ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          {children}
                        </a>
                      ) : (
                        <span>{children}</span>
                      ),
                  }}
                >
                  {data.text}
                </Markdown>
              </article>
            )}
            {rich.json !== undefined && (
              <RawLines text={rich.json} wrap={wrap} label="格式化 JSON" />
            )}
            {rich.rows && (
              <div className="file-preview-table">
                <Table aria-label="CSV 内容">
                  {header && rich.rows.length > 0 && (
                    <TableHeader>
                      <TableRow>
                        {rich.rows[0].map((cell, index) => (
                          <TableHead
                            key={index}
                            scope="col"
                            className="whitespace-normal"
                          >
                            {cell}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                  )}
                  <TableBody>
                    {rich.rows.slice(header ? 1 : 0).map((row, index) => (
                      <TableRow key={index}>
                        {row.map((cell, column) => (
                          <TableCell
                            key={column}
                            className="whitespace-pre-wrap"
                          >
                            {cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {rich.diff && (
              <DiffViewerLoader data={rich.diff} showRaw={() => setRaw(true)} />
            )}
          </PreviewBoundary>
        </div>
      )}
      <div className="file-preview-raw" hidden={!raw}>
        <PagedOriginal url={props.url} initial={data.page} wrap={wrap} />
      </div>
    </div>
  );
}

function PagedOriginal({
  url,
  initial,
  wrap,
}: {
  url: string;
  initial: PreviewPage;
  wrap: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState(() =>
    initial.end === initial.total
      ? 1
      : Math.ceil(initial.total / PREVIEW_PAGE_BYTES),
  );
  const [result, setResult] = useState<{
    key: string;
    page?: PreviewPage;
    error?: string;
  }>({ key: "0:0", page: initial });
  const key = `${index}:${attempt}`;
  useEffect(() => {
    if (index === 0 && attempt === 0) return;
    const controller = new AbortController();
    void readPreviewPage(url, index, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) {
          if (page.total === initial.total && page.end === page.total)
            setPages(page.index + 1);
          setResult(
            page.total !== initial.total
              ? { key, error: "文件大小已变化，请关闭后重新打开。" }
              : { key, page },
          );
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "读取失败，请重试。",
          });
      },
    );
    return () => controller.abort();
  }, [url, index, attempt, key, initial.total]);
  const ready = result.key === key;
  const page = ready ? result.page : undefined;
  const changePage = (next: number) => {
    setIndex(next);
    setAttempt((value) => value + 1);
  };
  return (
    <>
      <div
        className="file-preview-page-body"
        key={key}
        tabIndex={0}
        aria-label="附件原文"
      >
        {!ready ? (
          <p role="status">正在读取第 {index + 1} 段…</p>
        ) : result.error ? (
          <div role="alert">
            <p>{result.error}</p>
            <Button onClick={() => setAttempt((value) => value + 1)}>
              重试读取本段
            </Button>
          </div>
        ) : (
          page && (
            <>
              {page.start > 0 && (
                <p className="muted">
                  本段从文件中间开始，首行可能接续上一段。
                </p>
              )}
              <RawLines text={page.text} wrap={wrap} label="文件原文" />
            </>
          )
        )}
      </div>
      <div className="file-preview-pagination" aria-label="原文分段阅读">
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || index === 0}
          onClick={() => changePage(index - 1)}
        >
          上一段
        </Button>
        <span role="status">
          第 {index + 1} / {pages} 段
          {page &&
            ` · 字节 ${page.total ? page.start + 1 : 0}–${page.end} / ${page.total}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || index + 1 >= pages}
          onClick={() => changePage(index + 1)}
        >
          下一段
        </Button>
      </div>
    </>
  );
}

function RawLines({
  text,
  wrap,
  label,
}: {
  text: string;
  wrap: boolean;
  label: string;
}) {
  if (!text) return <p className="diff-evidence-message">文件为空。</p>;
  const lines = text.split("\n");
  return (
    <pre
      className={`file-preview-lines${wrap ? " is-wrapped" : ""}`}
      aria-label={label}
    >
      {lines.length <= 5_000
        ? lines.map((line, index) => (
            <span className="file-preview-line" key={index}>
              <span className="file-preview-line-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                {line}
                {index < lines.length - 1 ? "\n" : ""}
              </span>
            </span>
          ))
        : text}
    </pre>
  );
}

class PreviewBoundary extends Component<
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
