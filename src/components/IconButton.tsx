import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ReactNode;
  active?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  active,
  className = "",
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      aria-label={label}
      data-icon-tooltip={title || label}
      {...props}
    >
      {icon}
    </button>
  );
}
