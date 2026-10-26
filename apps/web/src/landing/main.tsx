import {
  ArrowRight,
  Check,
  Expand,
  FileText,
  Folder,
  Image,
  PackageCheck,
  RotateCcw,
  Shield,
} from "lucide-react";
import { SiteHeader } from "../components/site-header";
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

const startupCommand = "make docker-up";

const screenshots = [
  "/landing/current-dashboard-20261025.webp",
  "/landing/current-review-20261025.webp",
  "/landing/current-delivery-20261025.webp",
];
const captions = [
  "图 1: 交付看板 · 需求交付全景、验证结果分布与项目快速筛选",
  "图 2: 评审工作台 · 检查项预期与实际结果比对、多模态证据及逐项人工评审",
  "图 3: 交付与文档 · 冻结交付快照、版本效力追溯与一键生成离线文档",
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
      <SiteHeader
        brandHref="/landing.html"
        brandExtra={
          <Badge className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs text-muted font-mono">
            <span>个人本机使用</span>
          </Badge>
        }
      >
        <Scrollspy targetRef={scrollTarget} offset={80}>
          <nav aria-label="产品导航">
            <a
              href="#showcase"
              data-scrollspy-anchor="showcase"
              className="text-muted hover:text-fg transition-colors hidden md:inline-flex"
            >
              界面参考
            </a>
            <a
              href="#features"
              data-scrollspy-anchor="features"
              className="text-muted hover:text-fg transition-colors hidden md:inline-flex"
            >
              功能特性
            </a>
            <a
              href="#workflow"
              data-scrollspy-anchor="workflow"
              className="text-muted hover:text-fg transition-colors hidden md:inline-flex"
            >
              交付流程
            </a>
            <a
              href="#specification"
              data-scrollspy-anchor="specification"
              className="text-muted hover:text-fg transition-colors hidden md:inline-flex"
            >
              归档与规范
            </a>
            <Separator
              orientation="vertical"
              className="h-4 w-px bg-border hidden md:block"
            ></Separator>
            <Button asChild variant="default">
              <a href="/" className="text-xs">
                <span>进入工作台</span>
                <ArrowRight size={12} aria-hidden="true" />
              </a>
            </Button>
          </nav>
        </Scrollspy>
      </SiteHeader>

      <section
        className="pt-24 pb-16 px-6 relative overflow-hidden"
        data-od-id="hero"
      >
        <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
          <Badge className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-subtle border border-border text-xs text-fg-secondary font-mono mb-6 shadow-none">
            <span className="w-1.5 h-1.5 rounded-full bg-fg"></span>
            <span>本地优先 · 验证归档、人工评审与正式交付</span>
          </Badge>
          <h1 className="text-heading sm:text-heading-lg lg:text-display font-display tracking-normal text-fg leading-[1.1] mb-6">
            沉淀真实工程事实与证据
            <br className="hidden sm:inline" />
            <span className="text-fg-secondary font-display">
              严谨人工把关，确认正式交付
            </span>
          </h1>
          <p className="text-body text-fg-secondary max-w-2xl leading-relaxed mb-8">
            Acceptances 为本地开发提供确定性底座，完整归档 Agent
            在真实业务环境中产生的验证报告、多模态证据与代码版本。支持逐项人工评审与反馈驱动复验；在条件就绪时冻结不可变交付快照，并独立生成业务指南与测试报告。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-5 py-3 rounded-default bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-none flex items-center gap-2"
              >
                <span>打开交付验收工作台</span>
                <ArrowRight size={16} aria-hidden="true" />
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
            在源码目录执行以启动本机服务与 Docker MySQL，访问
            http://127.0.0.1:8765。开发调试使用 make dev（访问
            http://127.0.0.1:5173）。无外部账号依赖，轻量安全开箱即用。可选 Jev
            浏览器执行需另行配置 API Key。
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
                  aria-label="当前界面实拍"
                  className="order-last flex w-full lg:order-none lg:w-auto items-center justify-between gap-1 p-0.5 rounded-default bg-canvas border border-border text-xs font-mono h-auto"
                >
                  <TabsTrigger
                    value="0"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    1. 交付看板
                  </TabsTrigger>
                  <TabsTrigger
                    value="1"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    2. 评审工作台
                  </TabsTrigger>
                  <TabsTrigger
                    value="2"
                    className="w-tab px-2 lg:px-3 py-1 rounded-default transition-all text-muted hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-none h-auto flex-none text-xs"
                  >
                    3. 交付与文档
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    className="text-xs text-muted hover:text-fg font-mono flex items-center gap-1"
                    onClick={openActiveLightbox}
                  >
                    <Expand size={13} aria-hidden="true" />
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
                      src={screenshots[0]}
                      alt={captions[0]}
                      width={1600}
                      height={1000}
                      className="w-full h-auto block"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                      <span className="px-3 py-1.5 rounded-default bg-brand/90 text-brand-fg text-xs font-mono border border-brand-fg/10 backdrop-blur-sm">
                        点击放大查看真实截图
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
                      src={screenshots[1]}
                      alt={captions[1]}
                      width={1600}
                      height={1000}
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
                      src={screenshots[2]}
                      alt={captions[2]}
                      width={1600}
                      height={1000}
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
                      实拍自当前本机运行环境，基于 Acceptances
                      自身的真实研发归档数据；截图状态与数据严格真实对应。
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 font-mono text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    客观事实与人工裁决严格解耦
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    Docker MySQL 本地持久归档
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-border-dark"></span>
                    全流程追溯与反馈闭环
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
              从验证记录到交付文档
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              按项目、需求与每次实际运行组织，严格解耦客观事实、人工裁决与正式交付。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <Folder size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                本地优先与持久归档
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                采用 Docker MySQL
                统一持久化项目、需求、验证报告、人工评审记录、证据原文与离线交付文档。数据全量保存在本机环境，备份完整独立，杜绝数据外泄风险。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                默认仅监听本机地址，数据完全私有
                <br />
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                完整记录代码提交版本与未提交改动标记
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <Image size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                多模态证据深度关联
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                内置丰富预览器，完整支持高分辨率截图、执行录像、控制台日志、差异
                Diff、Markdown
                与格式化数据（JSON/CSV）。证据与检查项一一对应，支持原样下载追溯。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                预期指标、实际结果与现场证据逐项关联
                <br />
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                真实环境由 Agent 自主采集，杜绝口头主观臆测
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <Shield size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                逐项评审与批量通过
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                客观执行事实忠实归档且不可篡改。评审人可在 Web
                端对检查项逐项给出通过、不通过（附理由）、撤回或评论；亦可在汇总核验后批量确认整轮通过，权属清晰分明。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                评论仅记录过程讨论，不干扰当前判定状态
                <br />
                <Check
                  size={12}
                  className="inline-block align-middle mr-1"
                  aria-hidden="true"
                />{" "}
                新 Run 自动隔离，待重新人工评审以建立信任
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <RotateCcw size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                范围标识与反馈复验
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                每次 Run
                标明完整、局部或未知范围。复验继续归属原需求，自动关联历史未通过反馈，并记录逐条处理说明与阻碍原因，形成连续追溯链条。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                局部验收严格受限于本轮范围，不自动跨轮合并；反馈响应不继承人工判断，需重新评审以完成闭环。
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <PackageCheck size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                交付门禁与快照冻结
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                发布前严格校验准入条件：最新完整 Run 全项人工通过、Git
                工作区干净（无未提交改动）、真实构建通过以及地图素材完备。经用户显式确认后生成独立快照，固化当期证据副本。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                精确记录有效、失效、撤销与被替代等生命周期状态，改判或版本更新时效力严格可溯。
              </div>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none hover:border-border-dark transition-all">
              <div className="w-10 h-10 rounded-default bg-surface-subtle border border-border flex items-center justify-center text-fg mb-4">
                <FileText size={20} aria-hidden="true" />
              </div>
              <h3 className="text-base font-medium text-fg mb-2">
                业务指南与测试报告
              </h3>
              <p className="text-muted text-xs leading-relaxed mb-4">
                基于有效交付快照，一键分别生成面向业务人员的「操作指南」与面向产研团队的「测试报告」。双文档均独立版本化，支持在
                Web 端预览并导出内嵌完整图片的单文件离线 HTML。
              </p>
              <div className="text-xs font-mono text-muted bg-surface-subtle p-2 rounded-default border border-border">
                业务指南支持导入整理后的素材生成新版（素材限于当前交付）；文档生成纯本地渲染，不调用外部
                LLM。
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
              归档、评审、复验与正式交付
            </h2>
            <p className="text-muted text-sm">
              Agent
              负责业务环境中的真实检验与材料准备；用户核对证据、给出判定并显式确认交付。
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
                启动本地服务后在 Web 界面创建项目。首次接入时，在 Acceptances
                源码目录执行 make build 和 make install-skill 安装 CLI 与
                Acceptances-Cl 技能，随后在业务目录完成关联。支持同仓库多
                worktree 共用关联配置。
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
                执行验证并整包归档
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                Agent 在真实业务环境中执行测试与检查，生成 report.json
                并采集截图、录像及日志附件。提交前通过 acceptances validate
                进行预检；若为正式交付，需加 --formal
                参数并随同次验证打包交付材料。
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
                查看证据并人工评审
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                用户在 Web
                端查看各项预期与实际结果比对，结合现场证据进行逐项判定或批量人工通过。整轮所有检查项均通过才算本轮验收合格；只有最新完整范围
                Run 全项通过，需求方可整体通过。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                Web · 查看预期、实际结果与多模态证据，再作出人工判断
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                4
              </div>
              <h4 className="text-base font-medium text-fg">
                反馈驱动处理与复验
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                若存在未通过项，在业务开发会话中授权 Agent
                读取未通过反馈并针对性修复。真实验证后在原需求下提交新
                Run，附带处理说明并重新进入评审流程，保存评论本身不会自动调度
                Agent。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                <span className="text-brand-fg">$</span>
                acceptances feedback --campaign "需求名称"
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                5
              </div>
              <h4 className="text-base font-medium text-fg">
                核验就绪并确认交付
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                在需求交付准备界面，核对代码提交状态（工作区无残留修改）、真实构建、范围地图及说明素材。确认所有未通过项均附带合理接受理由后，由用户显式确认交付，冻结独立证据副本。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                Web · 查看交付准备 → 确认交付并冻结快照
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-brand text-brand-fg font-mono font-medium text-sm flex items-center justify-center shadow-none">
                6
              </div>
              <h4 className="text-base font-medium text-fg">
                生成与导出交付文档
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                在有效交付快照中，分别一键生成业务操作指南与产研测试报告。支持在
                Web 端预览并导出内嵌高保真图片的单文件离线
                HTML。交付版本失效、撤销或被替代后停止新生成，已有产物安全保留。
              </p>
              <div className="bg-brand text-brand-fg p-3 rounded-default font-mono text-xs overflow-x-auto shadow-none mt-1">
                Web · 查看交付快照 → 生成与导出业务指南 / 测试报告
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
              报告归档与人工评审规则
            </h2>
            <p className="text-muted text-sm">
              Project 组织需求交付 Campaign，每次实际验证保存为独立
              Run。报告与附件保存后不可原地修改，人工评审严格追加追溯。
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>上传包与 MySQL 归档</span>
                <span className="text-xs text-fg font-medium">
                  整包原子归档 · 幂等安全重试
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-default bg-surface-subtle">
                {
                  "上传包（业务目录自选）\nbundle/\n├── report.json          # 验证事实与附件清单\n├── .submission-id       # CLI 自动生成，上传重试复用\n├── login.jpg            # 清单声明的真实截图\n└── browser.log          # 运行时控制台与网络日志\n\n服务端归档（Docker MySQL）\n├── 项目、需求、报告与历次人工评审记录\n├── 证据文件完整内容与多模态资产\n└── 交付快照、独立文件引用与离线文档"
                }
              </pre>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                报告和全部附件保存完成后才对外可见。同一提交 ID
                和相同内容重试返回原 Run；同一 ID
                与不同内容会触发冲突报错，杜绝历史记录被意外篡改。
              </p>
            </FramePanel>

            <FramePanel className="bg-surface border border-border rounded-default p-4 shadow-none">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border text-xs font-mono text-muted">
                <span>逐项人工评审请求示例</span>
                <span className="text-xs text-fg font-medium">
                  原始结果与人工判断分别保存
                </span>
              </div>
              <pre className="font-mono text-xs text-fg leading-relaxed overflow-x-auto p-3 rounded-default bg-surface-subtle">
                {
                  'POST /api/v1/runs/<Run ID>/reviews\n\n{\n  "checkId": "c1",\n  "kind": "accepted",\n  "body": "已核对本项预期、实际结果与现场证据，符合要求。"\n}'
                }
              </pre>
              <p className="mt-3 text-xs text-muted leading-relaxed">
                用户在 Web
                提交人工判断，接口将其追加为不可变评审记录。全部检查项人工通过才本轮验收通过；只有最新完整范围
                Run
                全部人工通过，需求才整体就绪。逐项不通过须填理由，原始失败、阻塞或跳过项逐项人工通过也须填理由；批量人工通过无需理由，支持快速覆盖已有不通过判断。
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
              使用范围与能力边界
            </h2>
            <p className="text-muted text-sm">
              清晰界定当前系统能够保存什么、需要哪些前提，以及哪些操作仍由用户或外部
              Agent 完成。
            </p>
          </div>

          <FramePanel className="bg-surface border border-border rounded-default overflow-hidden shadow-none">
            <Table className="w-full table-fixed text-left text-xs border-collapse [&_th]:whitespace-normal [&_td]:whitespace-normal">
              <TableHeader>
                <TableRow className="bg-canvas border-b border-border text-muted font-mono">
                  <TableHead className="p-3 font-medium">评估场景</TableHead>
                  <TableHead className="p-3 font-medium text-fg-secondary">
                    当前功能
                  </TableHead>
                  <TableHead className="p-3 font-medium text-fg bg-surface-subtle">
                    使用边界
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border text-fg-secondary">
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    验证执行
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    归档外部 Agent 在业务环境中执行后提交的验证报告与证据附件
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    平台本身不运行业务测试，亦不自动采集截图、网络请求或日志
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    验证范围
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    明确区分完整验证、局部验证与范围未知，完整保留历次 Run 历史
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    局部 Run
                    验收仅代表当次验证范围，不自动跨轮合并；需求就绪依赖最新完整
                    Run
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    反馈复验
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    完整保存逐项裁决、评论、来源反馈与 Agent 填写的逐条处理说明
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    保存评论不会自动调度
                    Agent；用户需在业务开发会话中授权其拉取反馈并修复
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    数据治理
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    支持报告单向作废；在级联影响预览确认后，可彻底删除项目、需求与
                    Run
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    删除操作不设回收站；但已冻结的独立交付快照、交付证据副本及已有文档仍安全保留
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    交付效力
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    冻结指定 Run
                    的版本、范围、人审结论与证据副本，形成不可变交付快照
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    来源数据改判、撤回、作废或删除将使交付失效；重新达标不会自动恢复旧版本，需显式确认新交付
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="p-3 font-medium text-fg">
                    运行模式
                  </TableCell>
                  <TableCell className="p-3 text-muted">
                    本机独立部署与 Docker MySQL，无需外部云服务或第三方账号
                  </TableCell>
                  <TableCell className="p-3 font-medium text-fg bg-surface-subtle">
                    面向开发者个人单机使用，暂无团队多租户权限隔离；离线文档以生成时快照为准
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
            创建项目并关联业务代码库，快速开启真实验证与规范交付。让客观事实有据可查，让每一次验收与发布都严谨从容。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button asChild variant="ghost">
              <a
                href="index.html"
                className="px-6 py-3 rounded-default bg-brand hover:bg-brand-hover text-brand-fg font-medium text-sm transition-all shadow-none"
              >
                进入交付验收工作台
                <ArrowRight size={16} aria-hidden="true" />
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
          className="w-[min(1024px,calc(100%-32px))] max-w-none max-h-[90dvh] bg-transparent border-0 p-0 text-brand-fg shadow-none"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">截图放大预览</DialogTitle>
          <DialogDescription className="sr-only">
            当前界面实拍截图
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
            alt={captions[Number(showcaseTab)]}
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
