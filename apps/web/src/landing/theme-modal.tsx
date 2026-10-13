import { useEffect, useState } from "react";
import { toast } from "sonner";
import { THEME } from "./theme";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";

const tabs = [
  { value: "tokens", label: "视觉令牌清单" },
  { value: "tailwind", label: "Tailwind 配置" },
  { value: "css", label: "CSS 变量" },
  { value: "json", label: "结构化 JSON" },
  { value: "mcp", label: "MCP 自动化集成" },
];

export function ThemeModal({
  open,
  onOpenChange,
  returnFocus,
}: {
  returnFocus: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [themeJSON, setThemeJSON] = useState("");
  const [tab, setTab] = useState("tokens");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/landing/theme.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("主题配置加载失败");
        return response.json();
      })
      .then((data) => setThemeJSON(JSON.stringify(data, null, 2)))
      .catch(() => {
        if (!controller.signal.aborted)
          setThemeJSON(JSON.stringify(THEME, null, 2));
      });
    return () => controller.abort();
  }, [open]);
  const json = themeJSON || JSON.stringify(THEME, null, 2);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制配置内容");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "theme.json";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("已开始下载 theme.json");
  }
  function code(title: string, value: string, label: string) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-bold text-sm">{title}</h4>
          <Button variant="default" size="sm" onClick={() => void copy(value)}>
            {label}
          </Button>
        </div>
        <pre className="bg-brand text-brand-fg p-4 rounded-lg font-mono text-xs overflow-auto">
          <code>{value}</code>
        </pre>
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        className="theme-dialog"
        showCloseButton={false}
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-3 bg-surface-subtle/50">
          <div>
            <DialogTitle className="text-base">
              Modern Slate 主题设计规范与 MCP 清单
            </DialogTitle>
            <DialogDescription className="text-xs mt-1">
              {THEME.tagline}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={download}>
              下载 theme.json
            </Button>
            <Button
              variant="ghost"
              size="sm"
              autoFocus
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="block">
          <TabsList className="theme-tabs" aria-label="主题配置">
            {tabs.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="p-6 bg-surface-subtle/30">
            <TabsContent value="tokens" className="space-y-5 mt-0">
              <Card className="p-4 flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-bold text-sm">
                    Modern Slate 设计哲学与色彩体系
                  </h4>
                  <p className="text-muted mt-1">{THEME.desc}</p>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void copy(THEME.prompt)}
                >
                  复制设计 Prompt
                </Button>
              </Card>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {THEME.colors.map((color) => (
                  <Card
                    key={color.hex + color.name}
                    className="p-3 flex items-start gap-3"
                  >
                    <div
                      className="w-10 h-10 rounded-md shrink-0 border border-border"
                      style={{ backgroundColor: color.hex }}
                    />
                    <div className="min-w-0">
                      <strong>{color.name}</strong>
                      <div className="font-mono text-muted">{color.hex}</div>
                      <div className="font-mono text-fg-secondary">
                        {color.tw}
                      </div>
                      <p className="text-muted mt-1">{color.desc}</p>
                    </div>
                  </Card>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <h5 className="font-semibold mb-2">字体梯队 (Typography)</h5>
                  <p>Sans: PingFang SC, Segoe UI, Roboto, -apple-system</p>
                  <p className="font-mono">
                    Mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas
                  </p>
                </Card>
                <Card className="p-4">
                  <h5 className="font-semibold mb-2">
                    空间与圆角 (Spacing &amp; Radii)
                  </h5>
                  <p>徽章与小标签: 4px</p>
                  <p>标准按钮与输入框: 6px / 8px</p>
                  <p>卡片容器与弹窗: 12px</p>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="tailwind" className="mt-0">
              {code("Tailwind CSS 完整配置", THEME.tailwind, "一键复制配置")}
            </TabsContent>
            <TabsContent value="css" className="mt-0">
              {code("CSS 变量 (:root)", THEME.css, "一键复制 CSS")}
            </TabsContent>
            <TabsContent value="json" className="mt-0">
              {code("标准结构化 theme.json", json, "复制完整 JSON")}
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={download}
              >
                下载文件
              </Button>
            </TabsContent>
            <TabsContent value="mcp" className="space-y-5 mt-0">
              <Card className="p-4">
                <Badge variant="passed">MCP</Badge>
                <h4 className="font-bold text-sm">
                  下游工程自动化集成与配置注入
                </h4>
                <p>
                  通过标准 MCP 协议，接入该 Server 的 AI Agent
                  可直接将设计规范与主题令牌自动写入目标工程代码库。
                </p>
              </Card>
              {code(
                "方式 1: MCP Tool 结构化调用 (Payload)",
                THEME.mcpPayload,
                "复制 Payload",
              )}
              {code(
                "方式 2: AI Agent 提示词指令 (Prompt)",
                THEME.prompt,
                "复制 Prompt",
              )}
              {code("方式 3: 终端 CLI 一键执行", THEME.cli, "复制命令")}
            </TabsContent>
          </div>
        </Tabs>
        <div className="px-6 py-3 border-t border-border flex items-center justify-between gap-3 text-muted">
          <span>
            项目源文件: <code>assets/theme.json</code>
          </span>
          <Button variant="link" size="sm" onClick={() => void copy(json)}>
            复制完整 JSON 契约
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
