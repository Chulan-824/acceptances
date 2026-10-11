import "./landing-design.css";
import "./theme-modal.js";
import { activateModal } from "./modal-focus.js";

/**
 * Acceptances Landing Page 交互逻辑
 */
const captions = [
  "图 1: 工作台三栏视图 —— 左侧交付列表、中间证据清单展开与右侧多轮历史",
  "图 2: 抽屉用例全景 —— 4 项测试用例细化展开与底部可折叠详情说明",
  "图 3: 研发验收中枢总控 —— 交付特性看板、通过率统计与实时本地监听",
];
let releaseLightbox = null;

function switchShowcaseTab(index, btn) {
  document.querySelectorAll(".w-tab").forEach((b) => {
    b.classList.remove("bg-surface", "text-fg", "shadow-subtle", "font-medium");
    b.classList.add("text-muted");
    b.setAttribute("aria-pressed", "false");
  });
  if (btn) {
    btn.classList.add("bg-surface", "text-fg", "shadow-subtle", "font-medium");
    btn.classList.remove("text-muted");
    btn.setAttribute("aria-pressed", "true");
  }

  document.querySelectorAll(".showcase-pane").forEach((p, i) => {
    if (i === index) {
      p.classList.remove("hidden");
      p.classList.add("block");
    } else {
      p.classList.remove("block");
      p.classList.add("hidden");
    }
  });

  const captionEl = document.getElementById("showcaseCaption");
  if (captionEl) {
    captionEl.textContent = captions[index] || "";
  }
}

async function copyCommand(cmd) {
  const tip = document.getElementById("copyTip");
  try {
    await navigator.clipboard.writeText(cmd);
    if (tip) {
      tip.textContent = "✓ 已复制到剪贴板";
      tip.classList.add("text-accent");
      tip.classList.remove("text-muted");
      setTimeout(() => {
        tip.textContent = "点击复制";
        tip.classList.remove("text-accent");
        tip.classList.add("text-muted");
      }, 2000);
    }
  } catch {
    if (tip) tip.textContent = "复制失败，请手动复制";
  }
}

function openLightbox(src) {
  const modal = document.getElementById("lightboxModal");
  const img = document.getElementById("lightboxImg");
  if (modal && img) {
    img.src = src;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    releaseLightbox?.();
    releaseLightbox = activateModal(modal, closeLightbox);
  }
}

function openActiveLightbox() {
  const activePane =
    document.querySelector(".showcase-pane.block img") ||
    document.querySelector(".showcase-pane:not(.hidden) img");
  if (activePane) {
    openLightbox(activePane.src);
  }
}

function closeLightbox(e) {
  const modal = document.getElementById("lightboxModal");
  if (!modal) return;
  if (
    !e ||
    e.target.id === "lightboxModal" ||
    e.target.closest("#lightboxCloseBtn")
  ) {
    modal.classList.remove("flex");
    modal.classList.add("hidden");
    releaseLightbox?.();
    releaseLightbox = null;
  }
}

document.querySelectorAll(".w-tab").forEach((button, index) => {
  button.setAttribute("aria-pressed", String(index === 0));
});
const lightbox = document.getElementById("lightboxModal");
lightbox.setAttribute("role", "dialog");
lightbox.setAttribute("aria-modal", "true");
lightbox.setAttribute("aria-label", "截图放大预览");
lightbox.setAttribute("aria-hidden", "true");
document.querySelectorAll("[onclick]").forEach((element) => {
  if (element.tagName !== "DIV" || element.id === "lightboxModal") return;
  element.setAttribute("role", "button");
  element.setAttribute("tabindex", "0");
  element.setAttribute(
    "aria-label",
    element.querySelector("img") ? "放大当前截图" : "复制命令",
  );
  element.addEventListener("keydown", (event) => {
    if (
      event.target === element &&
      (event.key === "Enter" || event.key === " ")
    ) {
      event.preventDefault();
      element.click();
    }
  });
});

Object.assign(window, {
  switchShowcaseTab,
  copyCommand,
  openActiveLightbox,
  closeLightbox,
});

// 跳转位置待人工确认，保留设计稿地址但暂不跳转。
document.querySelectorAll("[data-pending-link]").forEach((link) => {
  link.addEventListener("click", (event) => event.preventDefault());
});
