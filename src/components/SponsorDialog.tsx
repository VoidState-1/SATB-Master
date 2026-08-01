import { X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

interface SponsorDialogProps {
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

// 使用相对应用入口的路径，兼容开发服务器与打包后的 file:// 页面。
const SPONSOR_QR_URL = "./assets/sponsor-alipay.jpg";

export function SponsorDialog({ onClose, returnFocusRef }: SponsorDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [returnFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // 弹窗内只有关闭按钮可操作，将键盘焦点留在弹窗中。
      event.preventDefault();
      closeButtonRef.current?.focus();
    }
  };

  return createPortal(
    <div
      className="sponsor-backdrop"
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="sponsor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sponsor-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="sponsor-dialog-header">
          <h2 id="sponsor-dialog-title">赞助作者</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="sponsor-dialog-close"
            aria-label="关闭赞助二维码"
            title="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="sponsor-dialog-body">
          <img
            className="sponsor-qr"
            src={SPONSOR_QR_URL}
            alt="支付宝赞助二维码"
            draggable={false}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
