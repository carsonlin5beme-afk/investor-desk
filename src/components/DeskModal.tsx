"use client";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { DialogRadioControl } from "@/components/AmbientRadio";
export function DeskModal({
  title,
  kicker,
  close,
  onDismiss,
  children,
  footer,
  wide = false,
  busy = false,
}: {
  title: string;
  kicker: string;
  close: () => void;
  onDismiss?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    id = useId();
  const [closing, setClosing] = useState(false);
  useLayoutEffect(() => {
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const d = ref.current;
    d?.showModal();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      d?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  function dismiss() {
    if (busy || closing) return;
    onDismiss?.();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      close();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(close, 160);
  }
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""} ${closing ? "is-closing" : ""}`}
      aria-labelledby={id}
      aria-busy={busy}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <header className="modal-head">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2 id={id}>{title}</h2>
        </div>
        <div className="modal-head-actions">
          <DialogRadioControl />
          <button
            type="button"
            className="icon-button"
            aria-label="Close dialog"
            onClick={dismiss}
            disabled={busy}
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className="modal-content">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </dialog>
  );
}
