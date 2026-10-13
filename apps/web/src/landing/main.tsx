import { Badge } from "../components/ui/badge";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../components/ui/table";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Toaster } from "../components/ui/sonner";
import { ThemeModal } from "./theme-modal";
import "./landing.css";

const screenshots = [
  "/landing/CleanShot-2026-09-17-at-14.06.10.webp",
  "/landing/CleanShot-2026-09-17-at-14.06.27.webp",
  "/landing/screenshot-2026-09-17T06-36-27-194Z.webp",
];
const captions = [
  "图 1: 工作台三栏视图 —— 左侧交付列表、中间证据清单展开与右侧多轮历史",
  "图 2: 抽屉用例全景 —— 4 项测试用例细化展开与底部可折叠详情说明",
  "图 3: 研发验收中枢总控 —— 交付特性看板、通过率统计与实时本地监听",
];
function Landing() {
  const [showcaseTab, setShowcaseTab] = useState("0");
  const [themeOpen, setThemeOpen] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copyTip, setCopyTip] = useState("点击复制");
  const themeTrigger = useRef<HTMLElement | null>(null);
  const lightboxTrigger = useRef<HTMLElement | null>(null);
  function openTheme() {
    themeTrigger.current = document.activeElement as HTMLElement;
    setThemeOpen(true);
  }
  function openActiveLightbox() {
    lightboxTrigger.current = document.activeElement as HTMLElement;
    setLightboxOpen(true);
  }
  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopyTip("已复制到剪贴板");
      toast.success("已复制安装命令");
    } catch {
      setCopyTip("复制失败，请手动复制");
      toast.error("复制失败，请手动复制命令");
    }
  }
  return (
    <>
      <header className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-md border-b border-border transition-colors">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a
              href="landing.html"
              className="flex items-center gap-2.5 font-semibold text-base tracking-tight hover:opacity-90"
            >
              <div className="w-7 h-7 rounded-md bg-brand text-brand-fg flex items-center justify-center font-bold text-sm shadow-subtle">
                A
              </div>
              <span>Acceptances</span>
              <span className="text-xs text-muted font-normal border-l border-border pl-2.5 hidden sm:inline">
                研发验收中枢
              </span>
            </a>
            <Badge className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-subtle border border-border text-xs text-muted font-mono">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
              <span>.acceptances/ 实时监听 (PID 43812)</span>
            </Badge>
          </div>

          <nav className="flex items-center gap-4 text-sm font-medium">
            <a
              href="#showcase"
              className="text-muted hover:text-fg transition-colors hidden md:inline-block"
            >
              产品全景
            </a>
            <a
              href="#features"
              className="text-muted hover:text-fg transition-colors hidden md:inline-block"
            >
              核心特性
            </a>
            <a
              href="#workflow"
              className="text-muted hover:text-fg transition-colors hidden md:inline-block"
            >
              交付闭环
            </a>
            <a
              href="#specification"
              className="text-muted hover:text-fg transition-colors hidden md:inline-block"
            >
              原位规范
            </a>
            <Separator
              orientation="vertical"
              className="h-4 w-px bg-border hidden sm:block"
            ></Separator>
            <Button
              variant="ghost"
              onClick={openTheme}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-subtle text-fg transition-all text-xs shadow-subtle flex items-center gap-1.5"
              title="查看 Modern Slate 主题配置规范与 MCP 初始化清单"
            >
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
              <span>主题规范 (MCP)</span>
            </Button>
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg transition-all text-xs font-medium shadow-subtle flex items-center gap-1.5"
              >
                <span>进入中枢</span>
                <span className="text-xs">→</span>
              </a>
            </Button>
          </nav>
        </div>
      </header>

      <section
        className="pt-16 pb-14 px-6 relative overflow-hidden"
        data-od-id="hero"
      >
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <Badge className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs text-fg-secondary font-mono mb-6 shadow-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
            <span>LOCAL-FIRST · 研发交付与多轮验收中枢</span>
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-fg leading-[1.15] mb-6">
            代码原位存证
            <br className="hidden sm:inline" />
            <span className="text-muted font-bold">重塑软件交付与验收闭环</span>
          </h1>
          <p className="text-lg text-muted max-w-2xl leading-relaxed mb-8">
            Acceptances 直接读取代码库根目录的
            <code className="px-1.5 py-0.5 rounded bg-surface-subtle border border-border font-mono text-fg text-sm">
              {".acceptances/"}
            </code>
            ，无缝呈现自动化回归结果、真实截图证据链与多轮修复历史，将口头交付转变为可追溯、防篡改的工程资产。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3.5">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-card flex items-center gap-2"
              >
                <span>打开研发验收中枢</span>
                <span>→</span>
              </a>
            </Button>
            <Button
              variant="ghost"
              aria-label="复制安装命令"
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface border border-border text-xs font-mono text-muted cursor-pointer hover:border-border-dark transition-all shadow-subtle group text-left whitespace-normal border-0"
              onClick={() => void copyCommand("npx acceptances open")}
              title="点击复制命令"
            >
              <span className="text-accent font-bold">$</span>
              <code className="text-fg">{"npx acceptances open"}</code>
              <span
                className="text-xs text-muted pl-1 border-l border-border group-hover:text-fg transition-colors"
                id="copyTip"
              >
                {copyTip}
              </span>
            </Button>
          </div>
        </div>
      </section>

      <section className="py-12 px-6" id="showcase" data-od-id="showcase">
        <Tabs
          value={showcaseTab}
          onValueChange={setShowcaseTab}
          className="block"
        >
          <div className="max-w-6xl mx-auto">
            <Card className="bg-surface border border-border rounded-2xl shadow-window overflow-hidden">
              <div className="h-11 px-4 bg-surface-subtle/80 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-danger"></span>
                  <span className="w-3 h-3 rounded-full bg-warning"></span>
                  <span className="w-3 h-3 rounded-full bg-accent"></span>
                  <span className="ml-2 text-xs font-mono text-muted">
                    acceptances · 本地优先验收工坊
                  </span>
                </div>

                <TabsList
                  aria-label="产品全景"
                  className="flex items-center gap-1 p-0.5 rounded-lg bg-canvas border border-border text-xs font-mono h-auto"
                >
                  <TabsTrigger
                    value="0"
                    className="w-tab px-3 py-1 rounded-md transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-subtle h-auto flex-none text-xs"
                  >
                    1. 工作台三栏
                  </TabsTrigger>
                  <TabsTrigger
                    value="1"
                    className="w-tab px-3 py-1 rounded-md transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-subtle h-auto flex-none text-xs"
                  >
                    2. 抽屉用例全景
                  </TabsTrigger>
                  <TabsTrigger
                    value="2"
                    className="w-tab px-3 py-1 rounded-md transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-subtle h-auto flex-none text-xs"
                  >
                    3. 研发中枢看板
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="text-xs text-muted hover:text-fg font-mono flex items-center gap-1"
                    onClick={openActiveLightbox}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>
                    </svg>
                    <span>放大查看</span>
                  </Button>
                </div>
              </div>

              <div className="relative bg-brand group cursor-zoom-in">
                <TabsContent value="0" className="showcase-pane relative mt-0">
                  <Button
                    variant="ghost"
                    className="showcase-preview block w-full p-0 border-0 rounded-none"
                    aria-label="放大当前截图"
                    onClick={openActiveLightbox}
                  >
                    <img
                      src="/landing/CleanShot-2026-09-17-at-14.06.10.webp"
                      alt="工作台三栏真实界面"
                      className="w-full h-auto block"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                      <span className="px-3 py-1.5 rounded-md bg-brand/90 text-brand-fg text-xs font-mono border border-brand-fg/10 backdrop-blur-sm">
                        点击放大查看实测截图
                      </span>
                    </div>
                  </Button>
                </TabsContent>

                <TabsContent value="1" className="showcase-pane relative mt-0">
                  <Button
                    variant="ghost"
                    className="showcase-preview block w-full p-0 border-0 rounded-none"
                    aria-label="放大当前截图"
                    onClick={openActiveLightbox}
                  >
                    <img
                      src="/landing/CleanShot-2026-09-17-at-14.06.27.webp"
                      alt="抽屉用例全景真实界面"
                      className="w-full h-auto block"
                    />
                  </Button>
                </TabsContent>

                <TabsContent value="2" className="showcase-pane relative mt-0">
                  <Button
                    variant="ghost"
                    className="showcase-preview block w-full p-0 border-0 rounded-none"
                    aria-label="放大当前截图"
                    onClick={openActiveLightbox}
                  >
                    <img
                      src="/landing/screenshot-2026-09-17T06-36-27-194Z.webp"
                      alt="研发中枢看板总控"
                      className="w-full h-auto block"
                    />
                  </Button>
                </TabsContent>
              </div>

              <div className="p-4 bg-surface-subtle border-t border-border flex flex-wrap items-center justify-between gap-4 text-xs">
                <div
                  className="font-mono text-fg-secondary flex items-center gap-2"
                  id="showcaseCaption"
                >
                  {captions[Number(showcaseTab)]}
                </div>
                <div className="flex items-center gap-3 font-mono text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                    双层结论隔离
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                    原位 .acceptances/ 读取
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                    reviews.json 签名
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </Tabs>
      </section>

      <section className="py-16 px-6" id="features" data-od-id="features">
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-3">
              为现代高品质工程团队量身打造
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              告别散落于 IM
              群聊的零碎截图与口头担保，让每一次功能发布都基于严密的工程事实。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-surface border border-border rounded-xl p-6 shadow-subtle hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h3 className="text-base font-semibold text-fg mb-2">
                代码库原位存证 (In-situ)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                零云端外部数据库依赖，验收用例、结果与证据原生保存在工作区
                <code className="font-mono text-fg bg-surface-subtle px-1 py-0.5 rounded">
                  {".acceptances/"}
                </code>
                目录，随 Git 分支版本化共进退。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ git branch 分离隔离
                <br />✓ 随 PR 审查一同合入
              </div>
            </Card>

            <Card className="bg-surface border border-border rounded-xl p-6 shadow-subtle hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
                  <circle cx="9" cy="9" r="2"></circle>
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
                </svg>
              </div>
              <h3 className="text-base font-semibold text-fg mb-2">
                确定性证据优先 (Evidence-First)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                测试不仅是单一的 Pass/Fail 计数，更内嵌高分辨率实测截图、网络
                HAR 抓包与控制台日志，杜绝“在我机器上是好的”口头扯皮。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ 自动化高分截图留底
                <br />✓ HAR 链路与异常日志追踪
              </div>
            </Card>

            <Card className="bg-surface border border-border rounded-xl p-6 shadow-subtle hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <h3 className="text-base font-semibold text-fg mb-2">
                双层核验与责任签署
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                机器验证客观事实写入
                <code className="font-mono text-fg bg-surface-subtle px-1 py-0.5 rounded">
                  {"result.json"}
                </code>
                ；人工业务审阅写入
                <code className="font-mono text-fg bg-surface-subtle px-1 py-0.5 rounded">
                  {"reviews.json"}
                </code>
                ，分权明确、责任闭环。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ 机器归机器，人工归人工
                <br />✓ 签署时间戳与责任人存证
              </div>
            </Card>
          </div>
        </div>
      </section>

      <section
        className="py-16 px-6 bg-surface-subtle border-y border-border"
        id="workflow"
        data-od-id="workflow"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-3">
              三步完成可审计的交付闭环
            </h2>
            <p className="text-muted text-sm">
              简单直接的命令行操作与直观的本地可视化，契合开发者日常编码节奏。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-bold text-sm flex items-center justify-center shadow-subtle">
                1
              </div>
              <h4 className="text-base font-semibold text-fg">
                自动化执行与证据捕获
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                开发者完成特性编码后，运行自动化验收脚本。脚本驱动真实本地服务，产出用例检查数据与高清截图存入对应特性
                Round 目录。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-lg font-mono text-xs overflow-x-auto shadow-subtle mt-1">
                <span className="text-accent-border">$</span>
                npm run accept:check
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-bold text-sm flex items-center justify-center shadow-subtle">
                2
              </div>
              <h4 className="text-base font-semibold text-fg">
                启动查看器可视化核验
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                运行一行 CLI 快速调起本地优先的 Acceptances
                查看器。三栏式直观对照用例预期、观察事实与截图证据，或在研发中枢全局巡检。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-lg font-mono text-xs overflow-x-auto shadow-subtle mt-1">
                <span className="text-accent-border">$</span>
                npx acceptances open
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-bold text-sm flex items-center justify-center shadow-subtle">
                3
              </div>
              <h4 className="text-base font-semibold text-fg">
                人工验收签署并入库封存
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                QA
                或研发负责人在界面中一键签署「交付接受」，签署人姓名与意见实时落盘至
                <code className="font-mono text-accent-dark">
                  {"reviews.json"}
                </code>
                ，随代码一同 Commit。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-lg font-mono text-xs overflow-x-auto shadow-subtle mt-1">
                <span className="text-accent-border">$</span>
                git add .acceptances & & git commit
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className="py-16 px-6"
        id="specification"
        data-od-id="specification"
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-3">
              透明开放的原位目录规范
            </h2>
            <p className="text-muted text-sm">
              完全基于文件系统约定，没有任何私有二进制黑盒，随处可读、永久归档。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-surface border border-border rounded-xl p-5 shadow-subtle">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>.acceptances/ 目录结构</span>
                <span className="text-xs text-accent font-semibold">
                  Git Tracked
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-lg bg-surface-subtle">
                {
                  "\n.acceptances/\n└── character-library/          # 交付特性主题 (Subject)\n    ├── round-1/                # 修复与验收轮次\n    │   ├── result.json         # 机器跑测客观结果\n    │   ├── reviews.json        # 人工验收签名与放行决策\n    │   └── assets/             # 真实证据沉淀\n    │       ├── c1-login.png    # 测试截图证据 1\n    │       ├── c1-table.png    # 测试截图证据 2\n    │       └── c1-trace.har    # 抓包记录\n    └── round-0/                # 历史未通过或修复前轮次"
                }
              </pre>
            </Card>

            <Card className="bg-surface border border-border rounded-xl p-5 shadow-subtle">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>reviews.json (人工签署真值)</span>
                <span className="text-xs text-accent font-semibold">
                  Dual-Tier Verification
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-lg bg-surface-subtle">
                {
                  '\n{\n  "status": "accepted",\n  "reviewer": "chulan",\n  "signed_at": "2026-08-31T21:24:00+08:00",\n  "commit": "24a65675",\n  "branch": "feature/character-library",\n  "summary": "4 项核心用例全部实测通过，截图与网络包一致，准予合并。",\n  "feedback": "同意交付，无阻断缺陷"\n}'
                }
              </pre>
            </Card>
          </div>
        </div>
      </section>

      <section
        className="py-16 px-6 bg-surface-subtle border-t border-border"
        id="comparison"
        data-od-id="comparison"
      >
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-3">
              为什么选择 Acceptances？
            </h2>
            <p className="text-muted text-sm">
              对比传统口头交付与重型云端测试管理系统。
            </p>
          </div>

          <Card className="bg-surface border border-border rounded-xl overflow-hidden shadow-subtle">
            <Table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="bg-canvas border-b border-border text-muted font-mono">
                  <TableHead className="p-3.5 font-medium">评估维度</TableHead>
                  <TableHead className="p-3.5 font-medium text-danger-dark">
                    传统群聊 / 口头交付
                  </TableHead>
                  <TableHead className="p-3.5 font-medium text-accent-dark bg-accent-soft/40">
                    Acceptances (本地优先)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border text-fg-secondary">
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    证据沉淀
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    群聊聊天记录易过期丢失
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    代码库同源版本化管理，永久留存
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    多轮历史
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    改动后难以与上一轮截图对比
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    Round 历史清晰可回溯，Diff 一目了然
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    责任确认
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    缺乏正式签名，出了问题互相推诿
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    reviews.json 责任人签字盖章存证
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    环境成本
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    搭建重型云端系统，网络卡顿繁琐
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    0 依赖极速启动，开箱即用
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </div>
      </section>

      <section className="py-20 px-6 text-center" data-od-id="cta">
        <div className="max-w-3xl mx-auto flex flex-col items-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-fg mb-4">
            立即在您的项目中启用 Acceptances
          </h2>
          <p className="text-muted text-sm max-w-xl leading-relaxed mb-8">
            为团队建立可信赖的质量防护网，让每一次迭代与发布都充满确定性。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-6 py-3 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-card"
              >
                进入研发验收中枢 →
              </a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="mt-auto py-8 px-6 border-t border-border bg-canvas text-xs text-muted">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-fg">Acceptances</span>
            <span>·</span>
            <span>Local-First Regression&amp;Round Sign-off System</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>branch: feature/character-library</span>
            <span>·</span>
            <Button
              variant="ghost"
              onClick={openTheme}
              className="hover:text-fg transition-colors"
            >
              主题与 MCP 规范
            </Button>
            <span>·</span>
            <a href="index.html" className="hover:text-fg transition-colors">
              中枢
            </a>
          </div>
        </div>
      </footer>

      <ThemeModal
        open={themeOpen}
        onOpenChange={setThemeOpen}
        returnFocus={() => themeTrigger.current?.focus()}
      />
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            lightboxTrigger.current?.focus();
          }}
          className="landing-lightbox"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">截图放大预览</DialogTitle>
          <DialogDescription className="sr-only">
            当前产品全景截图
          </DialogDescription>
          <Button
            variant="ghost"
            className="lightbox-close"
            autoFocus
            onClick={() => setLightboxOpen(false)}
          >
            关闭预览
          </Button>
          <img
            src={screenshots[Number(showcaseTab)]}
            alt="当前产品截图放大预览"
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-window border border-brand-fg/10"
          />
        </DialogContent>
      </Dialog>
      <Toaster position="bottom-right" />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
