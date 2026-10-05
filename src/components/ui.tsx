// Primitive UI Material 3 Expressive.
import {
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Icone (Material Symbols Rounded, asse FILL animato)
// ---------------------------------------------------------------------------

export function Icon({
  name,
  filled,
  size,
  className,
}: {
  name: string;
  filled?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("material-symbols-rounded shrink-0 select-none", filled && "filled", className)}
      style={size ? { fontSize: size } : undefined}
    >
      {name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bottoni — il raggio "si morfa" alla pressione (shape morph M3 Expressive)
// ---------------------------------------------------------------------------

type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "elevated" | "danger" | "tertiary";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  filled: "bg-primary text-on-primary hover:elev-1",
  tonal: "bg-secondary-container text-on-secondary-container",
  tertiary: "bg-tertiary-container text-on-tertiary-container",
  outlined: "border border-outline-variant text-primary",
  text: "text-primary",
  elevated: "bg-surface-container-low text-primary elev-1 hover:elev-2",
  danger: "bg-error text-on-error",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5 active:rounded-lg",
  md: "h-10 px-5 text-sm gap-2 active:rounded-xl",
  lg: "h-14 px-7 text-base gap-2.5 active:rounded-2xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  trailingIcon?: string;
  loading?: boolean;
}

export function Button({
  variant = "filled",
  size = "md",
  icon,
  trailingIcon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "state-layer inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-medium whitespace-nowrap",
        "transition-[border-radius,box-shadow,background-color,opacity] duration-300 ease-spring",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-default disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? 22 : 18} /> : icon && <Icon name={icon} size={size === "lg" ? 24 : 20} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={20} />}
    </button>
  );
}

type IconButtonVariant = "standard" | "filled" | "tonal" | "outlined";

export function IconButton({
  icon,
  variant = "standard",
  selected,
  size = 40,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  variant?: IconButtonVariant;
  selected?: boolean;
  size?: number;
  label: string;
}) {
  const styles: Record<IconButtonVariant, string> = {
    standard: selected ? "text-primary" : "text-on-surface-variant",
    filled: selected ? "bg-primary text-on-primary" : "bg-surface-container-highest text-primary",
    tonal: selected ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-highest text-on-surface-variant",
    outlined: selected ? "bg-inverse-surface text-inverse-on-surface" : "border border-outline-variant text-on-surface-variant",
  };
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "state-layer inline-flex shrink-0 cursor-pointer items-center justify-center",
        "transition-[border-radius,background-color,color] duration-300 ease-spring",
        selected ? "rounded-xl" : "rounded-full",
        "active:rounded-lg disabled:opacity-40",
        styles[variant],
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} filled={selected} size={Math.round(size * 0.55)} />
    </button>
  );
}

/** Floating Action Button (esteso se ha una label). */
export function Fab({
  icon,
  label,
  variant = "primary",
  size = "md",
  loading,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label?: string;
  variant?: "primary" | "secondary" | "tertiary" | "surface";
  size?: "md" | "lg";
  loading?: boolean;
}) {
  const colors = {
    primary: "bg-primary-container text-on-primary-container",
    secondary: "bg-secondary-container text-on-secondary-container",
    tertiary: "bg-tertiary-container text-on-tertiary-container",
    surface: "bg-surface-container-high text-primary",
  }[variant];
  const dims =
    size === "lg"
      ? cn("h-24 rounded-[28px] active:rounded-[40px] text-lg gap-3", label ? "px-8" : "w-24")
      : cn("h-14 rounded-2xl active:rounded-[22px] gap-3", label ? "pl-4 pr-5" : "w-14");
  return (
    <button
      type="button"
      disabled={loading || rest.disabled}
      className={cn(
        "state-layer elev-3 hover:elev-4 inline-flex cursor-pointer items-center justify-center font-medium",
        "transition-[border-radius,box-shadow,transform] duration-300 ease-spring active:scale-[0.97]",
        "disabled:opacity-50",
        colors,
        dims,
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === "lg" ? 32 : 24} /> : <Icon name={icon} filled size={size === "lg" ? 36 : 24} />}
      {label && <span>{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Progress & loading
// ---------------------------------------------------------------------------

/** Loading indicator M3 Expressive: forma organica che ruota e si morfa. */
export function Spinner({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0 bg-current opacity-90", className)}
      style={{ width: size * 0.8, height: size * 0.8, animation: "spin-morph 1.1s linear infinite" }}
    />
  );
}

/** Progress lineare "wavy" (M3 Expressive). `value` null = indeterminato. */
export function WavyProgress({ value, className }: { value: number | null; className?: string }) {
  const pct = value === null ? 35 : Math.max(0, Math.min(1, value)) * 100;
  const wave = "M0 6 Q 6 0 12 6 T 24 6 T 36 6 T 48 6 T 60 6 T 72 6 T 84 6 T 96 6 T 108 6 T 120 6";
  return (
    <div className={cn("relative h-3 w-full overflow-hidden", className)} role="progressbar" aria-valuenow={pct}>
      <div
        className="absolute top-1/2 right-0 h-1 -translate-y-1/2 rounded-full bg-secondary-container transition-[left] duration-500 ease-emphasized"
        style={{ left: `calc(${pct}% + 6px)` }}
      />
      <div
        className="absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-500 ease-emphasized"
        style={{ width: `${pct}%`, animation: value === null ? "indeterminate 1.4s ease-in-out infinite" : undefined }}
      >
        <svg className="h-3 w-[calc(100%+24px)]" preserveAspectRatio="none" style={{ animation: "wave 0.9s linear infinite" }}>
          <defs>
            <pattern id="wave-pattern" width="24" height="12" patternUnits="userSpaceOnUse">
              <path d={wave} fill="none" stroke="var(--md-primary)" strokeWidth="3" strokeLinecap="round" />
            </pattern>
          </defs>
          <rect width="100%" height="12" fill="url(#wave-pattern)" />
        </svg>
      </div>
      <span className="absolute top-1/2 right-0 size-1 -translate-y-1/2 rounded-full bg-primary" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Superfici
// ---------------------------------------------------------------------------

export function Card({
  children,
  className,
  onClick,
  variant = "filled",
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: "filled" | "elevated" | "outlined";
}) {
  const v = {
    filled: "bg-surface-container",
    elevated: "bg-surface-container-low elev-1",
    outlined: "border border-outline-variant bg-surface",
  }[variant];
  return (
    <div
      onClick={onClick}
      className={cn("rounded-2xl", v, onClick && "state-layer cursor-pointer", className)}
    >
      {children}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  actions,
  width = 520,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: string;
  children: ReactNode;
  actions?: ReactNode;
  width?: number;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fade bg-scrim/50" onClick={dismissable ? onClose : undefined} />
      <div
        role="dialog"
        aria-modal
        className="relative flex max-h-full w-full animate-pop flex-col overflow-hidden rounded-[28px] bg-surface-container-high elev-3"
        style={{ maxWidth: width }}
      >
        {(title || icon) && (
          <div className={cn("px-6 pt-6 pb-4", icon && "flex flex-col items-center text-center")}>
            {icon && <Icon name={icon} size={28} className="mb-3 text-secondary" />}
            <h2 className="type-headline text-[24px] text-on-surface">{title}</h2>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 text-sm text-on-surface-variant">{children}</div>
        {actions && <div className="flex items-center justify-end gap-2 px-6 pt-4 pb-6">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export function TextField({
  label,
  icon,
  supporting,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: string; supporting?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("group block", className)}>
      <div className="relative flex h-14 items-center rounded-t-lg border-b border-on-surface-variant bg-surface-container-highest transition-colors focus-within:border-b-2 focus-within:border-primary">
        {icon && <Icon name={icon} className="ml-3 text-on-surface-variant" size={22} />}
        <div className="relative flex h-full flex-1 flex-col justify-end px-4 pb-1.5">
          <span className="pointer-events-none absolute top-2 text-xs text-on-surface-variant group-focus-within:text-primary">
            {label}
          </span>
          <input
            id={id}
            className="w-full bg-transparent pt-4 text-[15px] text-on-surface outline-none placeholder:text-on-surface-variant/60"
            {...rest}
          />
        </div>
      </div>
      {supporting && <p className="mt-1 px-4 text-xs text-on-surface-variant">{supporting}</p>}
    </label>
  );
}

export function Select({
  label,
  children,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("group block", className)}>
      <div className="relative flex h-14 items-center rounded-t-lg border-b border-on-surface-variant bg-surface-container-highest focus-within:border-b-2 focus-within:border-primary">
        <span className="pointer-events-none absolute top-2 left-4 text-xs text-on-surface-variant group-focus-within:text-primary">
          {label}
        </span>
        <select
          id={id}
          className="h-full w-full cursor-pointer appearance-none bg-transparent px-4 pt-5 pr-10 text-[15px] text-on-surface outline-none [&>option]:bg-surface-container-high"
          {...rest}
        >
          {children}
        </select>
        <Icon name="arrow_drop_down" className="pointer-events-none absolute right-3 text-on-surface-variant" />
      </div>
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 disabled:opacity-40",
        checked ? "border-primary bg-primary" : "border-outline bg-surface-container-highest",
      )}
    >
      <span
        className={cn(
          "absolute flex items-center justify-center rounded-full transition-all duration-300 ease-spring",
          checked
            ? "left-[22px] size-6 bg-on-primary text-on-primary-container"
            : "left-1.5 size-4 bg-outline text-surface-container-highest group-active:size-7",
        )}
      >
        {checked && <Icon name="check" size={16} className="text-primary" />}
      </span>
    </button>
  );
}

/** Slider M3 Expressive: track spessa + handle verticale. */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  marks,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  marks?: number[];
}) {
  const pct = ((value - min) / Math.max(1, max - min)) * 100;
  return (
    <div className="group relative flex h-11 w-full items-center">
      <div className="absolute inset-x-0 flex h-4 items-center gap-1.5">
        <div className="h-4 rounded-l-full rounded-r-sm bg-primary" style={{ width: `calc(${pct}% - 6px)` }} />
        <div className="h-4 flex-1 rounded-l-sm rounded-r-full bg-secondary-container" />
      </div>
      {marks?.map((m) => (
        <span
          key={m}
          className={cn(
            "pointer-events-none absolute size-1 rounded-full",
            m <= value ? "bg-on-primary/70" : "bg-on-secondary-container/60",
          )}
          style={{ left: `calc(${((m - min) / (max - min)) * 100}% - 2px)` }}
        />
      ))}
      <div
        className="pointer-events-none absolute h-11 w-1 -translate-x-1/2 rounded-full bg-primary transition-[width] group-active:w-0.5"
        style={{ left: `${pct}%` }}
      >
        {format && (
          <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-inverse-surface px-3 py-1 text-xs font-semibold whitespace-nowrap text-inverse-on-surface opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100">
            {format(value)}
          </span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-0.5", className)} role="radiogroup">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "state-layer flex h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 px-3 text-sm font-medium",
              "transition-[border-radius,background-color] duration-300 ease-spring",
              active ? "rounded-full bg-secondary-container text-on-secondary-container" : "bg-surface-container-highest text-on-surface-variant",
              !active && i === 0 && "rounded-l-full rounded-r-md",
              !active && i === options.length - 1 && "rounded-l-md rounded-r-full",
              !active && i > 0 && i < options.length - 1 && "rounded-md",
            )}
          >
            {active ? <Icon name="check" size={18} /> : o.icon && <Icon name={o.icon} size={18} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  label,
  icon,
  selected,
  onClick,
  className,
}: {
  label: string;
  icon?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "state-layer inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium",
        "transition-[background-color,border-radius] duration-300 ease-spring active:rounded-2xl",
        selected
          ? "bg-secondary-container text-on-secondary-container"
          : "border border-outline-variant text-on-surface-variant",
        className,
      )}
    >
      {selected ? <Icon name="check" size={18} /> : icon && <Icon name={icon} size={18} />}
      {label}
    </button>
  );
}

export function Badge({ children, tone = "secondary" }: { children: ReactNode; tone?: "primary" | "secondary" | "tertiary" | "error" }) {
  const t = {
    primary: "bg-primary-container text-on-primary-container",
    secondary: "bg-secondary-container text-on-secondary-container",
    tertiary: "bg-tertiary-container text-on-tertiary-container",
    error: "bg-error-container text-on-error-container",
  }[tone];
  return <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-semibold", t)}>{children}</span>;
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex animate-enter flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="flex size-24 items-center justify-center rounded-[36px] bg-secondary-container text-on-secondary-container">
        <Icon name={icon} size={44} />
      </div>
      <h3 className="type-title mt-2">{title}</h3>
      {text && <p className="max-w-sm text-sm text-on-surface-variant">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
