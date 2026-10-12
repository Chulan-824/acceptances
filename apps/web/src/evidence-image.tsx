import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./components/ui/button";

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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
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
      </Dialog.Trigger>
      {open && <ImageViewer url={url} description={description} />}
    </Dialog.Root>
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

  function zoom(factor: number) {
    drag.current = null;
    setDragging(false);
    setTransform((current) => {
      const scale = Math.min(5, Math.max(1, current.scale * factor));
      return { scale, x: 0, y: 0 };
    });
  }

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="image-viewer-overlay" />
      <Dialog.Content className="image-viewer">
        <Dialog.Title className="sr-only">图片预览</Dialog.Title>
        <Dialog.Description className="sr-only">
          使用缩放按钮查看细节，放大后可拖动图片。按 Esc 或点击空白处关闭。
        </Dialog.Description>
        <Dialog.Close asChild>
          <button
            type="button"
            className="image-viewer-backdrop"
            aria-label="关闭图片预览"
            tabIndex={-1}
          />
        </Dialog.Close>
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
                setTransform((previous) => ({
                  ...previous,
                  x: Math.min(current.limitX, Math.max(-current.limitX, x)),
                  y: Math.min(current.limitY, Math.max(-current.limitY, y)),
                }));
              }}
              onLostPointerCapture={() => {
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
        <Dialog.Close asChild>
          <Button
            className="image-viewer-close image-viewer-control"
            aria-label="关闭预览"
            title="关闭预览（Esc）"
            size="icon"
          >
            <X aria-hidden="true" />
          </Button>
        </Dialog.Close>
        <div
          className="image-viewer-controls"
          role="group"
          aria-label="图片缩放"
        >
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
          <output aria-live="polite">
            {Math.round(transform.scale * 100)}%
          </output>
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
      </Dialog.Content>
    </Dialog.Portal>
  );
}
