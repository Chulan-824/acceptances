import { useEffect, useRef, type ReactNode } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";
import { PanelButton } from "../workspace-controls";

export function WorkspacePanels({
  left,
  main,
  right,
  leftCollapsed,
  rightCollapsed,
  onLeftCollapsedChange,
  onRightCollapsedChange,
}: {
  left: ReactNode;
  main: ReactNode;
  right: ReactNode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onLeftCollapsedChange: (collapsed: boolean) => void;
  onRightCollapsedChange: (collapsed: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const leftPanel = useRef<PanelImperativeHandle>(null);
  const rightPanel = useRef<PanelImperativeHandle>(null);
  const widths = useRef({ left: 300, right: 340 });
  useEffect(() => {
    const width = widths.current.left;
    if (leftCollapsed) leftPanel.current?.collapse();
    else {
      leftPanel.current?.expand();
      leftPanel.current?.resize(width);
    }
  }, [leftCollapsed]);
  useEffect(() => {
    const width = widths.current.right;
    if (rightCollapsed) rightPanel.current?.collapse();
    else {
      rightPanel.current?.expand();
      rightPanel.current?.resize(width);
    }
  }, [rightCollapsed]);
  function measure(side: "left" | "right", value: number, collapsed: boolean) {
    element.current?.style.setProperty(
      `--workspace-${side}-width`,
      `${value}px`,
    );
    if (!collapsed && value >= 200) widths.current[side] = value;
    if (!collapsed && value <= 49) {
      if (side === "left") onLeftCollapsedChange(true);
      else onRightCollapsedChange(true);
    }
  }
  return (
    <ResizablePanelGroup
      elementRef={element}
      className="workspace acceptance-workbench"
      orientation="horizontal"
      style={{ height: "100dvh" }}
    >
      <ResizablePanel
        id="deliveries"
        panelRef={leftPanel}
        defaultSize={300}
        collapsible
        collapsedSize={48}
        minSize={200}
        maxSize={400}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => measure("left", size.inPixels, leftCollapsed)}
      >
        {leftCollapsed ? (
          <aside className="panel-rail" aria-label="需求列表已收起">
            <PanelButton
              side="left"
              collapsed
              onClick={() => onLeftCollapsedChange(false)}
            />
            <span>需求</span>
          </aside>
        ) : (
          left
        )}
      </ResizablePanel>
      <ResizableHandle
        className="workspace-resize"
        disabled={leftCollapsed}
        aria-label="调整需求列表宽度"
      />
      <ResizablePanel id="report" minSize={480}>
        {main}
      </ResizablePanel>
      <ResizableHandle
        className="workspace-resize"
        disabled={rightCollapsed}
        aria-label="调整运行记录宽度"
      />
      <ResizablePanel
        id="history"
        panelRef={rightPanel}
        defaultSize={340}
        collapsible
        collapsedSize={48}
        minSize={200}
        maxSize={440}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => measure("right", size.inPixels, rightCollapsed)}
      >
        {rightCollapsed ? (
          <aside className="panel-rail" aria-label="运行记录已收起">
            <PanelButton
              side="right"
              collapsed
              onClick={() => onRightCollapsedChange(false)}
            />
            <span>运行记录</span>
          </aside>
        ) : (
          right
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
