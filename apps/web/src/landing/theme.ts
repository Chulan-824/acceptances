export const THEME = {
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
