import { activateModal } from "./modal-focus.js";

/**
 * Acceptances 主题配置查看与 MCP 初始化弹窗组件
 * 专为下游项目快速通过 MCP / CLI 接入 Modern Slate 设计系统打造
 */
(function () {
  let modalInstance = null;
  let releaseModal = null;

  const THEME = {
    name: "Modern Slate",
    tagline: "现代工程精密风 · 钛墨黑 + 松柏墨翠 (对标 Linear / Biome)",
    desc: "极致克制、代码与视觉降噪，解耦品牌主色与验收通过状态色。",
    colors: [
      {
        name: "Canvas (底盘背景)",
        hex: "#f8fafc",
        tw: "bg-canvas / slate-50",
        desc: "全局底盘冷灰，消除死白苍白感",
      },
      {
        name: "Surface (卡片表面)",
        hex: "#ffffff",
        tw: "bg-surface / white",
        desc: "内容卡片、容器与抽屉底色",
      },
      {
        name: "Surface Subtle (次级表面)",
        hex: "#f1f5f9",
        tw: "bg-surface-subtle / slate-100",
        desc: "代码块、搜索框、斑马纹底色",
      },
      {
        name: "Border (通用边框)",
        hex: "#e2e8f0",
        tw: "border-border / slate-200",
        desc: "卡片边框、分隔线与分割线",
      },
      {
        name: "Brand Primary (钛墨主色)",
        hex: "#0f172a",
        tw: "bg-brand / slate-900",
        desc: "品牌标识与全局主操作按钮",
      },
      {
        name: "Text Primary (主文字)",
        hex: "#0f172a",
        tw: "text-fg / slate-900",
        desc: "标题、度量数值与主正文",
      },
      {
        name: "Text Muted (次级弱字)",
        hex: "#64748b",
        tw: "text-muted / slate-500",
        desc: "时间戳、辅助说明与 Commit Hash",
      },
      {
        name: "Semantic Pass (通过/放行)",
        hex: "#059669",
        tw: "text-emerald-600 / bg-emerald-50",
        desc: "仅用于机器跑测通过与人工验收放行",
      },
      {
        name: "Semantic Pending (待验/警告)",
        hex: "#d97706",
        tw: "text-amber-600 / bg-amber-50",
        desc: "仅用于待人工签署、进行中与告警",
      },
      {
        name: "Semantic Reject (阻断/拒绝)",
        hex: "#e11d48",
        tw: "text-rose-600 / bg-rose-50",
        desc: "仅用于自动化阻断、打回与异常",
      },
    ],
    tailwind: `module.exports = {
  theme: {
    extend: {
      colors: {
        canvas: '#f8fafc',
        surface: { DEFAULT: '#ffffff', subtle: '#f1f5f9', hover: '#f8fafc' },
        fg: { DEFAULT: '#0f172a', secondary: '#334155', muted: '#64748b' },
        border: { DEFAULT: '#e2e8f0', dark: '#cbd5e1' },
        accent: { DEFAULT: '#059669', soft: '#ecfdf5', border: '#a7f3d0', dark: '#047857' },
        warning: { DEFAULT: '#d97706', soft: '#fffbeb', border: '#fde68a', dark: '#b45309' },
        danger: { DEFAULT: '#e11d48', soft: '#fff1f2', border: '#fecdd3', dark: '#be123c' },
        brand: { DEFAULT: '#0f172a', hover: '#1e293b', fg: '#ffffff' }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', '"PingFang SC"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      }
    }
  }
};`,
    css: `:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-subtle: #f1f5f9;
  --fg: #0f172a;
  --fg-secondary: #334155;
  --muted: #64748b;
  --border: #e2e8f0;
  --accent: #059669;
  --accent-soft: #ecfdf5;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --danger: #e11d48;
  --danger-soft: #fff1f2;
  --primary-btn: #0f172a;
  --primary-btn-hover: #1e293b;
  --primary-btn-fg: #ffffff;
}`,
    mcpPayload: `{\n  "server": "acceptances-design-mcp",\n  "tool": "init_theme_preset",\n  "args": {\n    "preset": "modern-slate",\n    "target": "./frontend",\n    "framework": "tailwind-v3",\n    "includeCssVariables": true,\n    "injectFiles": ["tailwind.config.js", "src/styles/tokens.css"]\n  }\n}`,
    prompt: `请通过 MCP 工具 \`init_theme_preset\` 将 Acceptances 的 Modern Slate (现代工程精密风) 主题配置写入当前项目，包含 Slate 灰阶、钛墨深黑主色与 Emerald/Amber/Rose 状态色定义。`,
    cli: `npx acceptances theme init --preset modern-slate`,
  };

  function createModalDOM() {
    if (modalInstance) return modalInstance;
    const overlay = document.createElement("div");
    overlay.id = "theme-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Modern Slate 主题配置规范与 MCP 清单");
    overlay.setAttribute("aria-hidden", "true");
    overlay.className =
      "fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-200";
    overlay.innerHTML = `
      <div id="theme-modal-container" class="bg-surface w-full max-w-4xl max-h-[90vh] rounded-xl shadow-2xl border border-border flex flex-col transform scale-95 transition-all duration-200 overflow-hidden text-fg font-sans">
        <div class="px-6 py-4 border-b border-border flex items-center justify-between bg-surface-subtle/50 flex-shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-fg text-surface flex items-center justify-center font-bold text-sm shadow-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-base text-fg tracking-tight">Modern Slate 主题配置规范与 MCP 清单</h3>
                <span class="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">v1.0.0 锁定基准</span>
              </div>
              <p class="text-xs text-muted mt-0.5">${THEME.tagline}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="theme-modal-export-btn" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border bg-surface hover:bg-surface-subtle text-fg-secondary transition-colors">
              <svg class="w-3.5 h-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
              下载 theme.json
            </button>
            <button id="theme-modal-close-btn" class="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-fg hover:bg-surface-subtle transition-colors" title="关闭 (ESC)">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>
        <div class="px-6 border-b border-border bg-surface flex items-center justify-between flex-shrink-0">
          <div class="flex items-center gap-1 -mb-px text-xs font-medium">
            <button data-tab="tokens" class="theme-tab-btn py-3 px-3 border-b-2 font-semibold border-fg text-fg flex items-center gap-1.5 transition-all"><span>🎨</span> 视觉令牌清单</button>
            <button data-tab="tailwind" class="theme-tab-btn py-3 px-3 border-b-2 border-transparent text-muted hover:text-fg flex items-center gap-1.5 transition-all"><span>⚙️</span> Tailwind 配置</button>
            <button data-tab="css" class="theme-tab-btn py-3 px-3 border-b-2 border-transparent text-muted hover:text-fg flex items-center gap-1.5 transition-all"><span>📄</span> CSS 变量</button>
            <button data-tab="json" class="theme-tab-btn py-3 px-3 border-b-2 border-transparent text-muted hover:text-fg flex items-center gap-1.5 transition-all"><span>📦</span> 标准 JSON</button>
            <button data-tab="mcp" class="theme-tab-btn py-3 px-3 border-b-2 border-transparent text-muted hover:text-fg flex items-center gap-1.5 transition-all">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span class="text-emerald-700 font-semibold">🔌 MCP 初始化</span>
            </button>
          </div>
          <div class="text-[11px] text-muted hidden sm:block">按 <kbd class="px-1.5 py-0.5 rounded bg-surface-subtle border border-border font-mono text-[10px]">ESC</kbd> 退出</div>
        </div>
        <div id="theme-tab-content" class="p-6 overflow-y-auto flex-1 bg-surface-subtle/30 text-xs leading-relaxed"></div>
        <div class="px-6 py-3 border-t border-border bg-surface flex items-center justify-between text-xs text-muted flex-shrink-0">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>项目原位文件: <code class="font-mono text-[11px] text-fg-secondary bg-surface-subtle px-1.5 py-0.5 rounded border border-border">assets/theme.json</code></span>
          </div>
          <button id="theme-modal-quick-copy-all" class="text-xs text-fg font-medium hover:underline flex items-center gap-1">复制完整 JSON 契约 →</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    modalInstance = overlay;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeThemeModal();
    });
    overlay
      .querySelector("#theme-modal-close-btn")
      .addEventListener("click", closeThemeModal);
    overlay
      .querySelector("#theme-modal-export-btn")
      .addEventListener("click", downloadThemeJSON);
    overlay
      .querySelector("#theme-modal-quick-copy-all")
      .addEventListener("click", () =>
        copyToClipboard(JSON.stringify(THEME, null, 2), "已复制主题配置 JSON"),
      );
    overlay
      .querySelectorAll(".theme-tab-btn")
      .forEach((btn) =>
        btn.addEventListener("click", () => switchTab(btn.dataset.tab)),
      );
    return overlay;
  }

  function renderTabContent(tabKey) {
    const el = document.getElementById("theme-tab-content");
    if (!el) return;

    if (tabKey === "tokens") {
      el.innerHTML = `
        <div class="space-y-5">
          <div class="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-start justify-between gap-4">
            <div>
              <h4 class="font-bold text-sm text-fg">Modern Slate 设计哲学与色彩层级</h4>
              <p class="text-muted mt-1 text-xs">${THEME.desc}</p>
            </div>
            <button onclick="window.copyPresetPrompt()" class="flex-shrink-0 px-3 py-1.5 rounded-lg bg-fg text-surface text-xs font-medium hover:bg-slate-800 transition-colors">复制主题 Prompt</button>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${THEME.colors
              .map(
                (c) => `
              <div class="bg-surface p-3 rounded-lg border border-border shadow-sm flex items-start gap-3 hover:border-slate-300 transition-colors">
                <div class="w-10 h-10 rounded-md shadow-inner flex-shrink-0 border border-black/10" style="background-color: ${c.hex}"></div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between">
                    <span class="font-semibold text-xs text-fg truncate">${c.name}</span>
                    <code class="font-mono text-[11px] text-muted">${c.hex}</code>
                  </div>
                  <div class="text-[11px] font-mono text-fg-secondary mt-0.5 truncate">${c.tw}</div>
                  <p class="text-[11px] text-muted mt-1 leading-snug">${c.desc}</p>
                </div>
              </div>`,
              )
              .join("")}
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-surface p-4 rounded-xl border border-border shadow-sm">
              <h5 class="font-semibold text-xs text-fg mb-2">🔤 字体阶梯 (Typography)</h5>
              <div class="space-y-2 text-xs">
                <div class="p-2 bg-surface-subtle rounded"><span class="text-muted">Sans:</span> <span class="font-sans font-medium text-fg">PingFang SC, Segoe UI, Roboto, -apple-system</span></div>
                <div class="p-2 bg-surface-subtle rounded"><span class="text-muted">Mono:</span> <span class="font-mono font-medium text-fg">ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas</span></div>
              </div>
            </div>
            <div class="bg-surface p-4 rounded-xl border border-border shadow-sm">
              <h5 class="font-semibold text-xs text-fg mb-2">📐 空间与圆角 (Radii)</h5>
              <div class="space-y-1.5 text-xs">
                <div class="flex justify-between p-1.5 bg-surface-subtle rounded"><span class="text-muted">徽章/小组件:</span><span class="font-mono text-fg">4px / rounded-sm</span></div>
                <div class="flex justify-between p-1.5 bg-surface-subtle rounded"><span class="text-muted">标准按钮/输入框:</span><span class="font-mono text-fg">6px / 8px (rounded-lg)</span></div>
                <div class="flex justify-between p-1.5 bg-surface-subtle rounded"><span class="text-muted">卡片/弹窗容器:</span><span class="font-mono text-fg">12px / rounded-xl</span></div>
              </div>
            </div>
          </div>
        </div>`;
    } else if (tabKey === "tailwind") {
      el.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div><h4 class="font-bold text-sm text-fg">Tailwind CSS 完整配置</h4><p class="text-muted text-xs">合并入新项目的 tailwind.config.js 中</p></div>
            <button onclick="window.copyCode('tailwind')" class="px-3 py-1.5 rounded-lg bg-fg text-surface text-xs font-medium hover:bg-slate-800 transition-colors">一键复制配置</button>
          </div>
          <div class="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800"><pre><code>${escapeHtml(THEME.tailwind)}</code></pre></div>
        </div>`;
    } else if (tabKey === "css") {
      el.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div><h4 class="font-bold text-sm text-fg">CSS 变量 (:root)</h4><p class="text-muted text-xs">适用于纯 CSS 或轻量原生微前端工程</p></div>
            <button onclick="window.copyCode('css')" class="px-3 py-1.5 rounded-lg bg-fg text-surface text-xs font-medium hover:bg-slate-800 transition-colors">一键复制 CSS</button>
          </div>
          <div class="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800"><pre><code>${escapeHtml(THEME.css)}</code></pre></div>
        </div>`;
    } else if (tabKey === "json") {
      el.innerHTML = `
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div><h4 class="font-bold text-sm text-fg">标准结构化 theme.json</h4><p class="text-muted text-xs">符合 W3C Design Tokens 规范与 MCP 传输标准</p></div>
            <div class="flex gap-2">
              <button onclick="window.downloadThemeJSON()" class="px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium hover:bg-surface-subtle">下载文件</button>
              <button onclick="window.copyCode('json')" class="px-3 py-1.5 rounded-lg bg-fg text-surface text-xs font-medium hover:bg-slate-800">复制完整 JSON</button>
            </div>
          </div>
          <div class="bg-slate-900 text-slate-100 p-4 rounded-xl font-mono text-xs overflow-x-auto border border-slate-800 max-h-[460px]"><pre><code id="theme-json-preview">正在加载 assets/theme.json ...</code></pre></div>
        </div>`;
      fetch("/landing/theme.json")
        .then((r) => {
          if (!r.ok) throw new Error("主题 JSON 加载失败");
          return r.json();
        })
        .then((data) => {
          const p = document.getElementById("theme-json-preview");
          if (p) p.textContent = JSON.stringify(data, null, 2);
        })
        .catch(() => {
          const p = document.getElementById("theme-json-preview");
          if (p) p.textContent = JSON.stringify(THEME, null, 2);
        });
    } else if (tabKey === "mcp") {
      el.innerHTML = `
        <div class="space-y-5">
          <div class="bg-gradient-to-r from-emerald-500/10 via-slate-100 to-transparent p-4 rounded-xl border border-emerald-500/30">
            <h4 class="font-bold text-sm text-fg flex items-center gap-2"><span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">MCP</span> 下游项目自动化连接与初始化</h4>
            <p class="text-xs text-fg-secondary mt-1 max-w-2xl">通过 MCP 协议，任何接入该 MCP Server 的 Agent 均可一键将该主题配置注入目标工程。</p>
          </div>
          <div class="bg-surface p-4 rounded-xl border border-border shadow-sm space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">方式 1: MCP Tool 结构化调用</span>
              <button onclick="window.copyCode('mcp-payload')" class="px-2.5 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-subtle">复制 Payload</button>
            </div>
            <div class="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-xs overflow-x-auto border border-slate-800"><pre><code>${escapeHtml(THEME.mcpPayload)}</code></pre></div>
          </div>
          <div class="bg-surface p-4 rounded-xl border border-border shadow-sm space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">方式 2: AI Agent 提示词指令 (Prompt)</span>
              <button onclick="window.copyPresetPrompt()" class="px-2.5 py-1 text-xs rounded bg-fg text-surface hover:bg-slate-800">复制 Prompt</button>
            </div>
            <div class="bg-surface-subtle p-3 rounded-lg border border-border text-xs text-fg leading-relaxed">"${THEME.prompt}"</div>
          </div>
          <div class="bg-surface p-4 rounded-xl border border-border shadow-sm space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-[11px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">方式 3: 终端 CLI 一键执行</span>
              <button onclick="window.copyCode('cli')" class="px-2.5 py-1 text-xs rounded border border-border bg-surface hover:bg-surface-subtle">复制命令</button>
            </div>
            <div class="bg-slate-900 text-emerald-400 p-3 rounded-lg font-mono text-xs border border-slate-800"><code>$ ${THEME.cli}</code></div>
          </div>
        </div>`;
    }
  }

  function switchTab(key) {
    const overlay = createModalDOM();
    overlay.querySelectorAll(".theme-tab-btn").forEach((b) => {
      b.className =
        b.dataset.tab === key
          ? "theme-tab-btn py-3 px-3 border-b-2 font-semibold border-fg text-fg flex items-center gap-1.5 transition-all"
          : "theme-tab-btn py-3 px-3 border-b-2 border-transparent text-muted hover:text-fg flex items-center gap-1.5 transition-all";
    });
    renderTabContent(key);
  }

  function openThemeModal(tab = "tokens") {
    const overlay = createModalDOM();
    switchTab(tab);
    overlay.classList.remove("opacity-0", "pointer-events-none");
    overlay
      .querySelector("#theme-modal-container")
      .classList.remove("scale-95");
    overlay.querySelector("#theme-modal-container").classList.add("scale-100");
    releaseModal?.();
    releaseModal = activateModal(overlay, closeThemeModal);
  }

  function closeThemeModal() {
    if (!modalInstance) return;
    modalInstance.classList.add("opacity-0", "pointer-events-none");
    modalInstance
      .querySelector("#theme-modal-container")
      .classList.remove("scale-100");
    modalInstance
      .querySelector("#theme-modal-container")
      .classList.add("scale-95");
    releaseModal?.();
    releaseModal = null;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function copyToClipboard(text, msg = "已复制到剪贴板") {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(msg))
      .catch(() => {
        const t = document.createElement("textarea");
        t.value = text;
        document.body.appendChild(t);
        t.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(t);
        showToast(copied ? msg : "复制失败，请手动复制配置内容");
      });
  }

  function showToast(msg) {
    let t = document.getElementById("theme-modal-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "theme-modal-toast";
      t.className =
        "fixed bottom-6 right-6 z-[60] bg-fg text-surface text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 transform translate-y-4 opacity-0 transition-all duration-200";
      document.body.appendChild(t);
    }
    t.innerHTML = `<span class="text-emerald-400">✓</span> <span>${msg}</span>`;
    t.classList.remove("translate-y-4", "opacity-0");
    setTimeout(() => t.classList.add("translate-y-4", "opacity-0"), 2200);
  }

  function downloadThemeJSON() {
    fetch("/landing/theme.json")
      .then((r) => {
        if (!r.ok) throw new Error("主题 JSON 下载失败");
        return r.text();
      })
      .then((text) => {
        const blob = new Blob([text], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "theme.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("已开始下载 theme.json");
      })
      .catch(() => {
        showToast("已自动复制配置内容");
        copyToClipboard(JSON.stringify(THEME, null, 2));
      });
  }

  window.openThemeModal = openThemeModal;
  window.closeThemeModal = closeThemeModal;
  window.downloadThemeJSON = downloadThemeJSON;
  window.copyPresetPrompt = () =>
    copyToClipboard(THEME.prompt, "已复制 MCP 初始化 Prompt");
  window.copyCode = (type) => {
    if (type === "tailwind")
      copyToClipboard(THEME.tailwind, "已复制 Tailwind 配置");
    else if (type === "css") copyToClipboard(THEME.css, "已复制 CSS 变量");
    else if (type === "json")
      copyToClipboard(JSON.stringify(THEME, null, 2), "已复制完整主题 JSON");
    else if (type === "mcp-payload")
      copyToClipboard(THEME.mcpPayload, "已复制 MCP Tool Payload");
    else if (type === "cli") copyToClipboard(THEME.cli, "已复制 CLI 命令");
  };
})();
