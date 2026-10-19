import { useEffect, useRef, useState, type ComponentType } from "react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import type { PreviewResource } from "./file-preview-formats";
import { createPreviewModuleLoader } from "./preview-module-loader";
import "./diff-evidence.css";
import "./file-preview.css";

export type FilePreviewProps = {
  url: string;
  name: string;
  description?: string;
  resources?: PreviewResource[];
};

export function isDocumentEvidence(name: string) {
  return /\.(md|markdown|txt|log|json|csv|diff|patch)$/i.test(name);
}

const loadViewer = createPreviewModuleLoader(
  () => import("./file-preview-viewer"),
  "file-preview-viewer",
);

export function FilePreview({
  label = "预览",
  ...props
}: FilePreviewProps & { label?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          ref={trigger}
          variant="outline"
          aria-label={`预览 ${props.name}`}
        >
          {label}
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent
          className="diff-evidence-dialog file-preview-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <header className="diff-evidence-header">
            <DialogTitle>{props.name}</DialogTitle>
            <DialogDescription>
              {props.description || "查看归档文件内容。"}
            </DialogDescription>
          </header>
          <ViewerLoader {...props} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ViewerLoader(props: FilePreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    attempt: number;
    Viewer?: ComponentType<FilePreviewProps>;
    failed?: boolean;
  }>();
  useEffect(() => {
    let active = true;
    void loadViewer().then(
      (module) => {
        if (active) setResult({ attempt, Viewer: module.FilePreviewViewer });
      },
      () => {
        if (active) setResult({ attempt, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  if (result?.attempt !== attempt)
    return (
      <p className="diff-evidence-message" role="status">
        正在加载文件预览…
      </p>
    );
  if (result.Viewer) return <result.Viewer {...props} />;
  return (
    <div className="diff-evidence-message" role="alert">
      <p>预览组件加载失败，请重试。若仍然失败，请保存当前输入后刷新页面。</p>
      <Button onClick={() => setAttempt((value) => value + 1)}>
        重试加载预览
      </Button>
    </div>
  );
}
