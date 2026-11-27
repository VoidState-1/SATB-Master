import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function iconButtonAt(target: EventTarget | null) {
  const button = target instanceof Element ? target.closest("button") : null;
  if (!(button instanceof HTMLButtonElement)) return undefined;
  const text = button.dataset.iconTooltip ||
    (!button.title && !button.textContent?.trim() && button.querySelector("svg") ? button.getAttribute("aria-label") : undefined);
  return text ? { button, text } : undefined;
}

export function IconTooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean; container: HTMLElement }>();

  const tipRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const halfWidth = tipRef.current.offsetWidth / 2;
    tipRef.current.style.left = `${Math.max(halfWidth + 6, Math.min(window.innerWidth - halfWidth - 6, tip.x))}px`;
  }, [tip]);

  useEffect(() => {
    let active: HTMLButtonElement | undefined;
    let timer: number | undefined;
    const dismiss = () => {
      window.clearTimeout(timer);
      active = undefined;
      setTip(undefined);
    };

    const show = (event: Event) => {
      const item = iconButtonAt(event.target);
      if (!item || active === item.button) return;
      if (event.type === "focusin" && !item.button.matches(":focus-visible")) return;
      dismiss();
      active = item.button;
      timer = window.setTimeout(() => {
        if (!item.button.isConnected) return;
        const rect = item.button.getBoundingClientRect();
        const above = rect.bottom + 36 > window.innerHeight;
        setTip({
          text: item.text,
          x: rect.left + rect.width / 2,
          y: above ? rect.top - 7 : rect.bottom + 7,
          above,
          container: item.button.closest("dialog:modal") ?? document.body,
        });
      }, 320);
    };

    const leave = (event: FocusEvent | PointerEvent) => {
      if (active?.contains(event.target as Node) && !active.contains(event.relatedTarget as Node)) dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    document.addEventListener("pointerover", show, true);
    document.addEventListener("pointerout", leave, true);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", leave);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
    document.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("blur", dismiss);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", show, true);
      document.removeEventListener("pointerout", leave, true);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", leave);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("blur", dismiss);
    };
  }, []);

  return tip ? createPortal(
    <span ref={tipRef} className="icon-tooltip" aria-hidden="true" style={{
      left: tip.x,
      top: tip.y,
      transform: tip.above ? "translate(-50%, -100%)" : "translateX(-50%)",
    }}>{tip.text}</span>,
    tip.container,
  ) : null;
}
