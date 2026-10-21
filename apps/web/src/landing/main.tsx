import { Scrollspy } from "../components/reui/scrollspy";
import { Badge } from "../components/reui/badge";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { FramePanel } from "../components/reui/frame";
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
import "./landing.css";

const startupCommand = "docker compose -f deploy/compose.yaml up --build -d";

const screenshots = [
  "/landing/CleanShot-2026-09-17-at-14.06.10.webp",
  "/landing/CleanShot-2026-09-17-at-14.06.27.webp",
  "/landing/screenshot-2026-09-17T06-36-27-194Z.webp",
];
const captions = [
  "图 1: 历史工作台界面，展示需求列表、检查项与运行记录",
  "图 2: 历史详情界面，展示预期、实际结果与截图证据",
  "图 3: 历史报告界面，展示需求说明与本轮验证记录",
];
function Landing() {
  const scrollTarget = useRef<Document | null>(document);
  const [showcaseTab, setShowcaseTab] = useState("0");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copyTip, setCopyTip] = useState("点击复制");
  const lightboxTrigger = useRef<HTMLElement | null>(null);
  function openActiveLightbox() {
    lightboxTrigger.current = document.activeElement as HTMLElement;
    setLightboxOpen(true);
  }
  async function copyCommand(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      setCopyTip("已复制到剪贴板");
      toast.success("已复制启动命令");
    } catch {
      setCopyTip("复制失败，请手动复制");
      toast.error("复制失败，请手动复制命令");
    }
  }
  return (
    <>
      <header className="sticky top-0 z-40 bg-canvas/90 backdrop-blur-md border-b border-border transition-colors">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <a
              href="landing.html"
              className="flex items-center gap-3 font-medium text-base tracking-tight hover:opacity-90"
            >
              <div className="w-7 h-7 rounded-default bg-brand text-brand-fg flex items-center justify-center font-medium text-sm shadow-none">
                A
              </div>
              <span>Acceptances</span>
              <span className="text-xs text-muted font-normal border-l border-border pl-3 hidden sm:inline">
                交付验证系统
              </span>
            </a>
            <Badge className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs text-muted font-mono">
              <span>个人本机使用</span>
            </Badge>
          </div>

          <Scrollspy targetRef={scrollTarget} offset={80}>
            <nav className="flex items-center gap-4 text-sm font-medium">
              <a
                href="#showcase"
                data-scrollspy-anchor="showcase"
                className="text-muted hover:text-fg transition-colors hidden md:inline-block"
              >
                产品全景
              </a>
              <a
                href="#features"
                data-scrollspy-anchor="features"
                className="text-muted hover:text-fg transition-colors hidden md:inline-block"
              >
                核心特性
              </a>
              <a
                href="#workflow"
                data-scrollspy-anchor="workflow"
                className="text-muted hover:text-fg transition-colors hidden md:inline-block"
              >
                交付闭环
              </a>
              <a
                href="#specification"
                data-scrollspy-anchor="specification"
                className="text-muted hover:text-fg transition-colors hidden md:inline-block"
              >
                规范体系
              </a>
              <Separator
                orientation="vertical"
                className="h-4 w-px bg-border hidden sm:block"
              ></Separator>
              <Button asChild variant="ghost">
                <a
                  href="index.html"
                  className="px-3 py-1.5 rounded-default bg-brand hover:bg-brand-hover text-brand-fg transition-all text-xs font-medium shadow-none flex items-center gap-1.5"
                >
                  <span>进入工作台</span>
                  <span className="text-xs">→</span>
                </a>
              </Button>
            </nav>
          </Scrollspy>
        </div>
      </header>

      <section
        className="pt-24 pb-16 px-6 relative overflow-hidden"
        data-od-id="hero"
      >
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <Badge className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs text-fg-secondary font-mono mb-6 shadow-none">
            <span className="w-1.5 h-1.5 rounded-full bg-fg"></span>
            <span>LOCAL-FIRST · 研发交付与多轮验证系统</span>
          </Badge>
          <h1 className="text-heading sm:text-heading-lg lg:text-display font-display tracking-normal text-fg leading-[1.1] mb-6">
            保存验证事实与证据
            <br className="hidden sm:inline" />
            <span className="text-fg-secondary font-display">
              构建清晰确凿的人工判断闭环
            </span>
          </h1>
          <p className="text-body text-fg-secondary max-w-2xl leading-relaxed mb-8">
            Acceptances
            聚合真实运行结果、多模态证据与代码版本，让执行事实与人工裁决清晰分离。无需外部云端依赖，在本地即可构建完整、可追溯的需求验收与复验闭环。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-5 py-3 rounded-default bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-none flex items-center gap-2"
              >
                <span>打开交付验收工作台</span>
                <span>→</span>
              </a>
            </Button>
            <Button
              variant="ghost"
              aria-label="复制启动命令"
              className="flex items-center gap-2 px-3 py-2 rounded-default bg-surface border border-border text-xs font-mono text-muted cursor-pointer hover:border-border-dark transition-all shadow-none group text-left whitespace-normal border-0 max-w-full h-auto"
              onClick={() => void copyCommand(startupCommand)}
              title="点击复制命令"
            >
              <span className="text-fg font-medium">$</span>
              <code className="text-fg break-words">{startupCommand}</code>
              <span
                className="text-xs text-muted pl-1 border-l border-border group-hover:text-fg transition-colors"
                id="copyTip"
              >
                {copyTip}
              </span>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted leading-relaxed">
            在 Acceptances 源码目录执行启动命令，然后访问
            http://127.0.0.1:8765。 开发时使用 make dev，访问
            http://127.0.0.1:5173。
          </p>
        </div>
      </section>

      <section
        className="py-12 lg:py-16 px-6"
        id="showcase"
        data-od-id="showcase"
      >
        <Tabs
          value={showcaseTab}
          onValueChange={setShowcaseTab}
          className="block"
        >
          <div className="max-w-7xl mx-auto">
            <FramePanel className="bg-surface border border-border rounded-default shadow-none overflow-hidden">
              <div className="min-h-11 px-4 py-3 lg:py-0 bg-surface-subtle border-b border-border flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-fg"></span>
                  <span className="w-3 h-3 rounded-full bg-fg-subtle"></span>
                  <span className="w-3 h-3 rounded-full bg-border-dark"></span>
                  <span className="ml-2 text-xs font-mono text-muted">
                    acceptances · 本地优先交付与验证工作台
                  </span>
                </div>

                <TabsList
                  aria-label="产品全景"
                  className="order-last flex w-full lg:order-none lg:w-auto items-center justify-between gap-1 p-0.5 rounded-default bg-canvas border border-border text-xs font-mono h-auto"
                >
                  <TabsTrigger
                    value="0"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    1. 历史工作台
                  </TabsTrigger>
                  <TabsTrigger
                    value="1"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    2. 历史详情
                  </TabsTrigger>
                  <TabsTrigger
                    value="2"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    3. 历史报告
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
                      alt="历史三栏工作台界面"
                      className="w-full h-auto block"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                      <span className="px-3 py-1.5 rounded-default bg-brand/90 text-brand-fg text-xs font-mono border border-brand-fg/10 backdrop-blur-sm">
                        点击放大查看历史截图
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
                      alt="历史检查项详情与证据界面"
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
                      alt="历史报告界面"
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
                  <div>
                    <p>{captions[Number(showcaseTab)]}</p>
                    <p className="mt-1 text-muted">
                      截图为历史界面示意，以当前工作台为准。当前报告在加载、手动刷新或评审操作后更新。
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 font-mono text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    执行与评审双层解耦
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    本机服务持久归档
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    结构化审计决策记录
                  </span>
                </div>
              </div>
            </FramePanel>
          </div>
        </Tabs>
      </section>

      <section className="py-16 px-6" id="features" data-od-id="features">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-heading font-display tracking-normal leading-normal text-fg mb-3">
              为高标准软件交付打造的确定性护栏
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              告别散落各处的零碎截图与口头确认，让每一次需求交付与验收都立足于客观完整的工程事实。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
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
              <h3 className="text-base font-medium text-fg mb-2">
                本地优先与持久归档 (Local-First)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                无需外部数据库或云端服务。报告与人工评审保存在本机
                SQLite，附件保存在服务端数据目录，正式部署使用持久数据卷。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                ✓ 默认仅通过本机地址访问
                <br />✓ 记录代码来源、提交版本与未提交改动标记
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
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
              <h3 className="text-base font-medium text-fg mb-2">
                多模态确定性证据链 (Evidence-First)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                测试不再只是抽象的通过统计，更完整内嵌高分辨率实测截图、网络抓包与控制台日志，杜绝无据可查的环境偏差与主观臆测。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                ✓ 像素级高清截图与录像留存
                <br />✓ 运行时网络请求与异常追踪
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
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
              <h3 className="text-base font-medium text-fg mb-2">
                执行事实与人工裁决解耦 (Dual-Tier)
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                客观执行事实忠实归档，不替用户预设接受决定；支持逐项人工审阅与整轮全部人工通过，权属清晰，形成严密复验闭环。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                ✓ 客观检验与主观判断权属分明
                <br />✓ 逐项精准反馈驱动下轮修复
              </div>
            </FramePanel>
          </div>
        </div>
      </section>

      <section
        className="py-16 px-6 bg-surface-subtle border-y border-border"
        id="workflow"
        data-od-id="workflow"
      >
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-heading font-display tracking-normal leading-normal text-fg mb-3">
              三步构建高效可靠的交付闭环
            </h2>
            <p className="text-muted text-sm">
              Agent 在业务环境完成验证，通过 CLI
              提交报告；用户在工作台查看证据并作出判断。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                1
              </div>
              <h4 className="text-base font-medium text-fg">
                启动服务并关联项目
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                启动服务后在 Web 创建项目。首次接入时，在 Acceptances
                源码目录执行 make build 和 make install-skill，安装 CLI 与
                acceptances-v1 skill，再到业务目录关联项目。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                <span className="text-brand-fg">$</span>
                acceptances link --project "项目名称"
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                2
              </div>
              <h4 className="text-base font-medium text-fg">
                执行验证并提交报告
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                Agent 先创建或选择需求，在真实业务环境执行检查，准备 report.json
                和截图、录像、日志等附件，再通过 CLI
                整包归档。每次实际验证形成独立 Run。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                <span className="text-brand-fg">$</span>
                acceptances publish --bundle ./bundle --campaign "需求名称"
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                3
              </div>
              <h4 className="text-base font-medium text-fg">
                逐项评审决策与闭环归档
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                用户在 Web
                逐项评审或确认本轮全部人工通过，决定与评论保存到服务端。需要复验时，在业务聊天中授权
                Agent 读取反馈、处理问题，并在同一需求下提交新 Run。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                <span className="text-brand-fg">$</span>
                acceptances feedback --campaign "需求名称"
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
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-heading font-display tracking-normal leading-normal text-fg mb-3">
              开放透明的数据规范与契约
            </h2>
            <p className="text-muted text-sm">
              Project 组织需求交付 Campaign，每次实际验证保存为独立
              Run。报告与附件保存后不可原地修改，人工评审追加历史。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>上传包与服务端归档</span>
                <span className="text-xs text-fg font-medium">
                  Structured &amp; Versioned
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-default bg-surface-subtle">
                {
                  "上传包（业务目录自选）\nbundle/\n├── report.json          # 验证事实与附件清单\n├── .submission-id       # CLI 自动生成，上传重试复用\n├── login.png            # 清单声明的附件\n└── browser.log\n\n归档位置（服务端数据目录）\n├── archive.db           # 项目、需求、报告与人工评审\n└── evidence/<Run ID>/   # 本轮附件"
                }
              </pre>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>逐项人工评审请求示例</span>
                <span className="text-xs text-fg font-medium">
                  Dual-Tier Verification
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-default bg-surface-subtle">
                {
                  'POST /api/v1/runs/<Run ID>/reviews\n\n{\n  "checkId": "c1",\n  "kind": "accepted",\n  "body": "已核对本项预期、实际结果与证据。"\n}'
                }
              </pre>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                用户在 Web
                提交人工判断，接口将其追加为评审记录。全部检查项人工通过才本轮通过；只有最新完整范围
                Run 全部人工通过，需求才整体通过。新 Run 重新等待评审。
              </p>
            </FramePanel>
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
            <h2 className="text-heading font-display tracking-normal leading-normal text-fg mb-3">
              为什么选择 Acceptances？
            </h2>
            <p className="text-muted text-sm">
              对比传统口头交接与臃肿庞杂的云端测试管理平台。
            </p>
          </div>

          <FramePanel className="bg-surface border border-border rounded-default overflow-hidden shadow-none">
            <Table className="w-full text-left text-xs border-collapse">
              <TableHeader>
                <TableRow className="bg-canvas border-b border-border text-muted font-mono">
                  <TableHead className="p-3 font-medium">评估维度</TableHead>
                  <TableHead className="p-3 font-medium text-fg-secondary">
                    即时通讯 / 口头交接
                  </TableHead>
                  <TableHead className="p-3 font-medium text-fg bg-surface-subtle">
                    Acceptances (本地优先)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border text-fg-secondary">
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    证据沉淀
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    截图与聊天记录零散割裂，极易过期清理或遗漏
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    与需求交付深度绑定，多模态证据完整固化、持久可查
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    复验演进
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    多次改动后难以对照历史轮次的证据差异
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    多轮验证与复验轨迹完整追溯，前后对比直观确凿
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    决策归属
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    缺乏明确审阅依据，验收边界模糊
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    逐项审阅与裁决意见清晰存证，人机协同责任明确
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    使用成本
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    需搭建重型云服务与配置账号权限，维护成本高
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    本机部署，无需账号、外部数据库或云端服务
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </FramePanel>
        </div>
      </section>

      <section className="py-12 lg:py-16 px-6 text-center" data-od-id="cta">
        <div className="max-w-3xl mx-auto flex flex-col items-center">
          <h2 className="text-heading sm:text-heading-lg font-display tracking-normal leading-[1.1] text-fg mb-4">
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
                className="px-6 py-3 rounded-default bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-none"
              >
                进入交付验收工作台 →
              </a>
            </Button>
          </div>
        </div>
      </section>

      <footer className="mt-auto py-8 px-6 border-t border-border bg-canvas text-xs text-muted">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-medium text-fg">Acceptances</span>
            <span>·</span>
            <span>本地优先的研发交付与多轮验收系统</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <a href="index.html" className="hover:text-fg transition-colors">
              工作台
            </a>
          </div>
        </div>
      </footer>

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
            className="max-w-full max-h-[80vh] object-contain rounded-default shadow-none border border-brand-fg/10"
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
