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
  "图 1: 三栏式工作台 —— 左侧需求交付列表，中间证据与检查项展开，右侧完整复验历史",
  "图 2: 检查项详情抽屉 —— 单项结果与预期对照，内嵌高清截图证据与上下文详情",
  "图 3: 交付全局看板 —— 汇总各需求交付状态、单轮通过率统计与本地实时状态",
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
                交付验证系统
              </span>
            </a>
            <Badge className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-subtle border border-border text-xs text-muted font-mono">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
              <span>本地服务运行中 (PID 43812)</span>
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
              规范体系
            </a>
            <Separator
              orientation="vertical"
              className="h-4 w-px bg-border hidden sm:block"
            ></Separator>
            <Button
              variant="ghost"
              onClick={openTheme}
              className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-subtle text-fg transition-all text-xs shadow-subtle flex items-center gap-1.5"
              title="查看 Modern Slate 主题设计规范与 MCP 清单"
            >
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
              <span>设计规范 (MCP)</span>
            </Button>
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg transition-all text-xs font-medium shadow-subtle flex items-center gap-1.5"
              >
                <span>进入工作台</span>
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
            <span>LOCAL-FIRST · 研发交付与多轮验证系统</span>
          </Badge>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-fg leading-[1.15] mb-6">
            保存验证事实与证据
            <br className="hidden sm:inline" />
            <span className="text-muted font-bold">
              构建清晰确凿的人工判断闭环
            </span>
          </h1>
          <p className="text-lg text-muted max-w-2xl leading-relaxed mb-8">
            Acceptances
            聚合真实运行结果、多模态证据与代码版本，让执行事实与人工裁决清晰分离。无需外部云端依赖，在本地即可构建完整、可追溯的需求验收与复验闭环。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3.5">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-card flex items-center gap-2"
              >
                <span>打开交付验收工作台</span>
                <span>→</span>
              </a>
            </Button>
            <Button
              variant="ghost"
              aria-label="复制启动命令"
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
                    acceptances · 本地优先交付与验证工作台
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
                    3. 交付总控看板
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
                      alt="三栏式工作台实测界面"
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
                      alt="检查项详情与证据抽屉实测界面"
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
                      alt="交付总控看板实测界面"
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
                    执行与评审双层解耦
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                    本地原位证据归档
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent"></span>
                    结构化审计决策记录
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
              为高标准软件交付打造的确定性护栏
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              告别散落各处的零碎截图与口头确认，让每一次需求交付与验收都立足于客观完整的工程事实。
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
                本地优先与原位存证 (Local-First)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                零外部云端与数据库依赖，验收用例、结果与证据原生保存在本地工作区，保障核心业务数据隐私，并随代码版本持续演进。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ 本地独立运行，无网络泄露风险
                <br />✓ 完整保留代码提交版本上下文
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
                多模态确定性证据链 (Evidence-First)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                测试不再只是抽象的通过统计，更完整内嵌高分辨率实测截图、网络抓包与控制台日志，杜绝无据可查的环境偏差与主观臆测。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ 像素级高清截图与录像留存
                <br />✓ 运行时网络请求与异常追踪
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
                执行事实与人工裁决解耦 (Dual-Tier)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                客观执行事实忠实归档，不替用户预设接受决定；支持逐项人工审阅与整轮一键交付，权属清晰，形成严密复验闭环。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded border border-border">
                ✓ 客观检验与主观判断权属分明
                <br />✓ 逐项精准反馈驱动下轮修复
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
              三步构建高效可靠的交付闭环
            </h2>
            <p className="text-muted text-sm">
              轻量顺畅的 CLI
              指令结合直观的可视化工作台，自然融入开发者的日常研发节奏。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-bold text-sm flex items-center justify-center shadow-subtle">
                1
              </div>
              <h4 className="text-base font-semibold text-fg">
                环境执行与证据捕获
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                Agent
                或开发者在真实业务环境中运行验收用例，系统自动收集检查状态、运行日志与多模态证据并完整归档。
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
                一键启动本地可视化核验
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                通过轻量 CLI
                快速调起本地工作台，在清晰的三栏视图中对照预期与实测表现，多维度审查证据与上下文细节。
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
                逐项评审决策与闭环归档
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                审阅者对检查项进行独立判定或整轮一键交付，结构化记录决策意见；未通过项可直接交由
                Agent 针对性修复并开启复验。
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
              开放透明的数据规范与契约
            </h2>
            <p className="text-muted text-sm">
              完全基于结构化标准约定，没有任何私有二进制黑盒，随处可读、便于扩展与长期留存。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-surface border border-border rounded-xl p-5 shadow-subtle">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>.acceptances/ 组织规范</span>
                <span className="text-xs text-accent font-semibold">
                  Structured &amp; Versioned
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-lg bg-surface-subtle">
                {
                  "\n.acceptances/\n└── character-library/          # 需求交付主题 (Campaign)\n    ├── round-1/                # 验证与复验轮次 (Run)\n    │   ├── result.json         # 客观检验结果与事实清单\n    │   ├── reviews.json        # 人工审阅意见与交付裁决\n    │   └── assets/             # 多模态真实证据归档\n    │       ├── c1-login.png    # 实测截图证据 1\n    │       ├── c1-table.png    # 实测截图证据 2\n    │       └── c1-trace.har    # 网络请求与日志轨迹\n    └── round-0/                # 历史复验追溯轮次"
                }
              </pre>
            </Card>

            <Card className="bg-surface border border-border rounded-xl p-5 shadow-subtle">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>reviews.json (人工审阅决策契约)</span>
                <span className="text-xs text-accent font-semibold">
                  Dual-Tier Verification
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-lg bg-surface-subtle">
                {
                  '\n{\n  "status": "accepted",\n  "reviewer": "chulan",\n  "signed_at": "2026-08-31T21:24:00+08:00",\n  "commit": "24a65675",\n  "branch": "feature/character-library",\n  "summary": "4 项核心用例实测通过，截图与关键日志核验一致，准予交付。",\n  "feedback": "同意交付，核心功能完整且验证证据充分"\n}'
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
              对比传统口头交接与臃肿庞杂的云端测试管理平台。
            </p>
          </div>

          <Card className="bg-surface border border-border rounded-xl overflow-hidden shadow-subtle">
            <Table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="bg-canvas border-b border-border text-muted font-mono">
                  <TableHead className="p-3.5 font-medium">评估维度</TableHead>
                  <TableHead className="p-3.5 font-medium text-danger-dark">
                    即时通讯 / 口头交接
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
                    截图与聊天记录零散割裂，极易过期清理或遗漏
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    与需求交付深度绑定，多模态证据完整固化、持久可查
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    复验演进
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    多次改动后难以对照历史轮次的证据差异
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    多轮验证与复验轨迹完整追溯，前后对比直观确凿
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    决策归属
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    缺乏明确审阅依据，验收边界模糊
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    逐项审阅与裁决意见清晰存证，人机协同责任明确
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3.5 font-medium text-fg">
                    使用成本
                  </TableCell>
                  <TableCell className="p-3.5 text-muted">
                    需搭建重型云服务与配置账号权限，维护成本高
                  </TableCell>
                  <TableCell className="p-3.5 font-medium text-fg bg-accent-soft/10">
                    零外部依赖，极速本地启动，开箱即用且保护隐私
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
            为 Agent
            驱动的软件工程构筑坚固的交付底座，让每一次迭代与发布都有据可依。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-6 py-3 rounded-lg bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-card"
              >
                进入交付验收工作台 →
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
            <span>本地优先的研发交付与多轮验收系统</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>branch: feature/character-library</span>
            <span>·</span>
            <Button
              variant="ghost"
              onClick={openTheme}
              className="hover:text-fg transition-colors"
            >
              设计规范 (MCP)
            </Button>
            <span>·</span>
            <a href="index.html" className="hover:text-fg transition-colors">
              工作台
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
