import { useEffect, useState, type ComponentType } from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import "./diff-evidence.css";

type ViewerProps = { url: string };
let viewerModule: Promise<ComponentType<ViewerProps>> | undefined;
let failedModuleURL: URL | undefined;
let retrySequence = 0;

function safeViewerURL(error: unknown): URL | undefined {
  if (!(error instanceof Error)) return;
  for (const match of error.message.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    try {
      const candidate = new URL(match[0]);
      if (
        candidate.origin === window.location.origin &&
        !candidate.username &&
        !candidate.password &&
        /\/(?:diff-evidence-viewer\.tsx|diff-evidence-viewer-[A-Za-z0-9_-]+\.js)$/.test(
          candidate.pathname,
        )
      )
        return candidate;
    } catch {
      /* Unrecognized browser errors use the download/refresh fallback. */
    }
  }
}

function loadViewerModule(): Promise<ComponentType<ViewerProps>> {
  if (!viewerModule) {
    let load: Promise<typeof import("./diff-evidence-viewer")>;
    if (failedModuleURL) {
      const retryURL = new URL(failedModuleURL);
      retryURL.searchParams.set("diff-preview-retry", String(++retrySequence));
      load = import(/* @vite-ignore */ retryURL.href);
    } else {
      // Keep the normal path statically analyzable for production chunk splitting.
      load = import("./diff-evidence-viewer");
    }
    viewerModule = load
      .then(({ DiffEvidenceViewer }) => DiffEvidenceViewer)
      .catch((error: unknown) => {
        failedModuleURL = safeViewerURL(error);
        viewerModule = undefined;
        throw error;
      });
  }
  return viewerModule;
}

export function EvidenceDiff({ url, name }: { url: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" aria-label={`查看代码变更 ${name}`}>
          查看代码变更
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent className="diff-evidence-dialog">
          <header className="diff-evidence-header">
            <DialogTitle>代码变更</DialogTitle>
            <span className="diff-evidence-name">{name}</span>
            <DialogDescription>
              展示归档补丁中的差异和上下文，不能展开附件之外的源码。
            </DialogDescription>
          </header>
          <div className="diff-evidence-download">
            <Button asChild variant="outline" size="sm">
              <a
                href={`${url}${url.includes("?") ? "&" : "?"}download=1`}
                download
              >
                下载原文件
              </a>
            </Button>
          </div>
          <ViewerLoader key={url} url={url} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ViewerLoader({ url }: ViewerProps) {
  const [attempt, setAttempt] = useState(0);
  return (
    <ViewerModule
      key={attempt}
      url={url}
      retry={() => setAttempt(attempt + 1)}
    />
  );
}

function ViewerModule({ url, retry }: ViewerProps & { retry: () => void }) {
  const [result, setResult] = useState<
    { Viewer: ComponentType<ViewerProps> } | { error: true; retryable: boolean }
  >();
  useEffect(() => {
    let active = true;
    void loadViewerModule().then(
      (Viewer) => {
        if (active) setResult({ Viewer });
      },
      () => {
        if (active)
          setResult({ error: true, retryable: failedModuleURL !== undefined });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (!result)
    return (
      <p className="diff-evidence-message" role="status">
        正在加载代码预览…
      </p>
    );
  if ("error" in result)
    return (
      <div className="diff-evidence-message" role="alert">
        {result.retryable ? (
          <>
            <p>代码预览组件加载失败，请重试或下载原文件。</p>
            <Button onClick={retry}>重试加载预览</Button>
          </>
        ) : (
          <p>
            代码预览组件加载失败，浏览器未提供可恢复的模块地址。请下载原文件，或保存当前输入后刷新页面再试。
          </p>
        )}
      </div>
    );
  return <result.Viewer url={url} />;
}
