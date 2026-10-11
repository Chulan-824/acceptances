// 为设计稿的两个覆盖弹窗补充焦点圈定、Esc 和关闭后的焦点恢复。
export function activateModal(modal, close) {
  const previousFocus = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  const controls = () =>
    [...modal.querySelectorAll('button, a[href], [tabindex="0"]')].filter(
      (element) => element.getClientRects().length,
    );
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  controls()[0]?.focus({ preventScroll: true });
  function keydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  document.addEventListener("keydown", keydown);
  return () => {
    document.removeEventListener("keydown", keydown);
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = previousOverflow;
    if (previousFocus instanceof HTMLElement)
      previousFocus.focus({ preventScroll: true });
  };
}
