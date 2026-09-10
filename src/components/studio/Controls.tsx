"use client";
import { useId, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o, i) => (
        <button
          type="button"
          key={o.value}
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const next =
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? options.length - 1
                  : (i + (e.key === "ArrowRight" ? 1 : -1) + options.length) %
                    options.length;
            onChange(options[next].value);
            (
              e.currentTarget.parentElement?.children[next] as HTMLButtonElement
            )?.focus();
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <span>{icon}</span>}
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function SaveState({
  busy,
  error,
  saved,
}: {
  busy: boolean;
  error: string;
  saved?: boolean;
}) {
  return error ? (
    <p className="error-box" role="alert">
      {error}
    </p>
  ) : (
    <span className="save-state" role="status">
      {busy ? (
        <>
          <Loader2 size={15} className="spin" />
          Saving…
        </>
      ) : saved ? (
        <>
          <Check size={15} />
          Saved
        </>
      ) : null}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="form-field">
      {label}
      {children}
      {hint && <small id={id}>{hint}</small>}
    </label>
  );
}
export function ClearButton({
  onClick,
  label = "Clear search",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      <X size={16} />
    </button>
  );
}
