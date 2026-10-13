import { useEffect, useRef, useState } from "react";
import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";

export function EvidenceImage({
  url,
  description,
  label,
  eager,
}: {
  url: string;
  description: string;
  label: string;
  eager: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="image-preview" aria-label={label}>
          <img
            loading={eager ? "eager" : "lazy"}
            src={url}
            alt={description}
            onError={() => setImageError(true)}
          />
          {imageError && (
            <span className="image-preview-error" role="status">
              图片加载失败
            </span>
          )}
        </Button>
      </DialogTrigger>
      {open && <ImageViewer url={url} description={description} />}
    </Dialog>
  );
}

function ImageViewer({
  url,
  description,
}: {
  url: string;
  description: string;
}) {
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [imageError, setImageError] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    limitX: number;
    limitY: number;
  } | null>(null);
  const rafId = useRef<number | null>(null);
  const pendingTransform = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  function zoom(factor: number) {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    pendingTransform.current = null;
    drag.current = null;
    setDragging(false);
    setTransform((current) => {
      const scale = Math.min(5, Math.max(1, current.scale * factor));
      return { scale, x: 0, y: 0 };
    });
  }

  return (
    <DialogContent
      overlayClassName="image-viewer-overlay bg-brand/90"
      className="image-viewer top-0 left-0 translate-x-0 translate-y-0 w-screen max-w-none h-screen rounded-none border-0 bg-transparent p-0 shadow-none"
      showCloseButton={false}
    >
      <DialogTitle className="sr-only">图片预览</DialogTitle>
      <DialogDescription className="sr-only">
        使用缩放按钮查看细节，放大后可拖动图片。按 Esc 或点击空白处关闭。
      </DialogDescription>
      <DialogClose asChild>
        <button
          type="button"
          className="image-viewer-backdrop"
          aria-label="关闭图片预览"
          tabIndex={-1}
        />
      </DialogClose>
      <div className="image-viewer-stage">
        {imageError ? (
          <p className="image-viewer-error" role="alert">
            图片加载失败，请关闭预览后重试。
          </p>
        ) : (
          <img
            className="image-viewer-image"
            src={url}
            alt={description}
            draggable={false}
            data-zoomed={transform.scale > 1}
            data-dragging={dragging}
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            }}
            onError={() => setImageError(true)}
            onPointerDown={(event) => {
              if (event.button !== 0 || transform.scale <= 1) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.setPointerCapture(event.pointerId);
              if (rafId.current !== null) {
                cancelAnimationFrame(rafId.current);
                rafId.current = null;
              }
              pendingTransform.current = null;
              drag.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                x: transform.x,
                y: transform.y,
                limitX: Math.max(0, (bounds.width - window.innerWidth) / 2),
                limitY: Math.max(0, (bounds.height - window.innerHeight) / 2),
              };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              const current = drag.current;
              if (!current || current.pointerId !== event.pointerId) return;
              const x = current.x + event.clientX - current.startX;
              const y = current.y + event.clientY - current.startY;
              const nextX = Math.min(
                current.limitX,
                Math.max(-current.limitX, x),
              );
              const nextY = Math.min(
                current.limitY,
                Math.max(-current.limitY, y),
              );
              pendingTransform.current = { x: nextX, y: nextY };

              if (rafId.current === null) {
                rafId.current = requestAnimationFrame(() => {
                  rafId.current = null;
                  if (pendingTransform.current) {
                    const { x: targetX, y: targetY } = pendingTransform.current;
                    pendingTransform.current = null;
                    setTransform((previous) => ({
                      ...previous,
                      x: targetX,
                      y: targetY,
                    }));
                  }
                });
              }
            }}
            onLostPointerCapture={() => {
              if (rafId.current !== null) {
                cancelAnimationFrame(rafId.current);
                rafId.current = null;
              }
              if (pendingTransform.current) {
                const { x: targetX, y: targetY } = pendingTransform.current;
                pendingTransform.current = null;
                setTransform((previous) => ({
                  ...previous,
                  x: targetX,
                  y: targetY,
                }));
              }
              drag.current = null;
              setDragging(false);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
        )}
      </div>
      <DialogClose asChild>
        <Button
          className="image-viewer-close image-viewer-control"
          aria-label="关闭预览"
          title="关闭预览（Esc）"
          size="icon"
        >
          <X aria-hidden="true" />
        </Button>
      </DialogClose>
      <div className="image-viewer-controls" role="group" aria-label="图片缩放">
        <Button
          className="image-viewer-control"
          aria-label="缩小图片"
          title="缩小图片"
          size="icon"
          disabled={imageError || transform.scale <= 1}
          onClick={() => zoom(1 / 1.5)}
        >
          <ZoomOut aria-hidden="true" />
        </Button>
        <output aria-live="polite">{Math.round(transform.scale * 100)}%</output>
        <Button
          className="image-viewer-control"
          aria-label="放大图片"
          title="放大图片"
          size="icon"
          disabled={imageError || transform.scale >= 5}
          onClick={() => zoom(1.5)}
        >
          <ZoomIn aria-hidden="true" />
        </Button>
        <Button
          className="image-viewer-control"
          aria-label="重置缩放"
          title="重置缩放"
          size="icon"
          disabled={imageError || transform.scale === 1}
          onClick={() => zoom(0)}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>
    </DialogContent>
  );
}
