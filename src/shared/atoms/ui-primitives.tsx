import Link, { type LinkProps } from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export type UiTone =
  | "white"
  | "slate"
  | "blue"
  | "blueWhite"
  | "sky"
  | "emerald"
  | "emeraldWhite"
  | "amber"
  | "amberWhite"
  | "orange"
  | "red"
  | "rose"
  | "violet";

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const panelPadding = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
  xl: "p-6",
};

const panelAppearances = {
  default: "rounded-lg border border-slate-200 bg-white shadow-sm",
  structural: "rounded-none border border-slate-300 bg-white shadow-none",
};

type UiPanelProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "div";
  padding?: keyof typeof panelPadding;
  appearance?: keyof typeof panelAppearances;
};

export function UiPanel({ as: Component = "section", padding = "md", appearance = "default", className, children, ...props }: UiPanelProps) {
  return (
    <Component className={classNames(panelAppearances[appearance], panelPadding[padding], className)} {...props}>
      {children}
    </Component>
  );
}

const buttonVariants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  emeraldPrimary: "bg-emerald-600 text-white hover:bg-emerald-700",
  amberPrimary: "bg-amber-600 text-white hover:bg-amber-700",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  slate: "bg-slate-900 text-white hover:bg-slate-800",
  blueOutline: "border border-blue-200 bg-white text-blue-700 hover:bg-blue-50",
  blue: "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  emerald: "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  amber: "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  orange: "border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100",
  red: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  ghost: "text-slate-500 hover:bg-slate-50",
};

const buttonSizes = {
  compact: "h-7 px-2 text-xs",
  xs: "h-8 px-2 text-xs",
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-3 text-sm",
  mdXs: "h-9 px-3 text-xs",
  iconXs: "h-8 w-8 px-0 text-xs",
  iconMd: "h-9 w-9 px-0 text-sm",
  lg: "h-11 px-4 text-sm",
};

type UiButtonStyleProps = {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
};

function buttonClassName({ variant = "secondary", size = "md", className }: UiButtonStyleProps & { className?: string }) {
  return classNames(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
    buttonSizes[size],
    buttonVariants[variant],
    className,
  );
}

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & UiButtonStyleProps;

export function UiButton({ variant = "secondary", size = "md", className, type = "button", ...props }: UiButtonProps) {
  return <button type={type} className={buttonClassName({ variant, size, className })} {...props} />;
}

type UiLinkButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & UiButtonStyleProps & {
  href: LinkProps["href"];
  children: ReactNode;
};

export function UiLinkButton({ variant = "secondary", size = "md", className, href, children, ...props }: UiLinkButtonProps) {
  return (
    <Link href={href} className={buttonClassName({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}

type UiAnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & UiButtonStyleProps & {
  href: string;
  children: ReactNode;
};

export function UiAnchorButton({ variant = "secondary", size = "md", className, href, children, ...props }: UiAnchorButtonProps) {
  return (
    <a href={href} className={buttonClassName({ variant, size, className })} {...props}>
      {children}
    </a>
  );
}

const badgeTones: Record<UiTone, string> = {
  white: "border-slate-200 bg-white text-slate-600",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  blueWhite: "border-blue-200 bg-white text-blue-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  emeraldWhite: "border-emerald-200 bg-white text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  amberWhite: "border-amber-200 bg-white text-amber-700",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  red: "border-red-200 bg-red-50 text-red-700",
  rose: "border-rose-100 bg-rose-50 text-rose-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

const badgeSizes = {
  xs: "px-2 py-0.5 text-[11px]",
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1 text-xs",
};

type UiBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: UiTone;
  size?: keyof typeof badgeSizes;
  bordered?: boolean;
  shape?: "pill" | "rectangular";
};

export function UiBadge({ tone = "slate", size = "sm", bordered = true, shape = "pill", className, children, ...props }: UiBadgeProps) {
  return (
    <span className={classNames("inline-flex items-center font-semibold", shape === "pill" ? "rounded-full" : "rounded-none", bordered && "border", badgeSizes[size], badgeTones[tone], className)} {...props}>
      {children}
    </span>
  );
}

const noticeTones = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  info: "border-blue-100 bg-blue-50 text-blue-800",
  success: "border-emerald-100 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
};

type UiNoticeProps = HTMLAttributes<HTMLDivElement> & {
  tone?: keyof typeof noticeTones;
  radius?: "md" | "none";
  size?: "sm" | "xs" | "compact";
};

const noticeRadii = {
  md: "rounded-md",
  none: "rounded-none",
};

const noticeSizes = {
  sm: "px-3 py-2 text-sm",
  xs: "px-3 py-2 text-xs",
  compact: "px-2 py-1 text-xs",
};

export function UiNotice({ tone = "info", radius = "md", size = "sm", className, children, ...props }: UiNoticeProps) {
  return (
    <div className={classNames("border leading-6", noticeRadii[radius], noticeSizes[size], noticeTones[tone], className)} {...props}>
      {children}
    </div>
  );
}

const emptyStateTones = {
  neutral: "border-slate-200 bg-white text-slate-500",
  muted: "border-slate-200 bg-slate-50 text-slate-500",
  info: "border-blue-200 bg-blue-50/40 text-slate-600",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
};

const emptyStateHeights = {
  none: "",
  sm: "min-h-16",
  md: "min-h-48",
  lg: "min-h-72",
};

type UiEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  tone?: keyof typeof emptyStateTones;
  minHeight?: keyof typeof emptyStateHeights;
};

export function UiEmptyState({ tone = "neutral", minHeight = "none", className, children, ...props }: UiEmptyStateProps) {
  return (
    <div className={classNames("grid place-items-center rounded-md border border-dashed px-3 py-4 text-center text-sm", emptyStateTones[tone], emptyStateHeights[minHeight], className)} {...props}>
      {children}
    </div>
  );
}

type UiFieldProps = HTMLAttributes<HTMLLabelElement | HTMLDivElement> & {
  as?: "label" | "div";
};

export function UiField({ as: Component = "label", className, children, ...props }: UiFieldProps) {
  return (
    <Component className={classNames("grid gap-1 text-xs font-semibold text-slate-500", className)} {...props}>
      {children}
    </Component>
  );
}

const fieldSurfaces = {
  default: "bg-white",
  muted: "bg-slate-50",
};

const fieldBorders = {
  default: "border-slate-200",
  info: "border-blue-100",
};

const textInputSizes = {
  md: "h-9",
  lg: "h-10",
};

const fieldPadding = {
  sm: "px-2",
  md: "px-3",
};

const fieldTextTones = {
  default: "text-slate-900",
  muted: "text-slate-800",
};

type UiTextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  surface?: keyof typeof fieldSurfaces;
  borderTone?: keyof typeof fieldBorders;
  inputSize?: keyof typeof textInputSizes;
  inputPadding?: keyof typeof fieldPadding;
  textTone?: keyof typeof fieldTextTones;
};

export function UiTextInput({ className, surface = "default", borderTone = "default", inputSize = "md", inputPadding = "sm", textTone = "default", ...props }: UiTextInputProps) {
  return (
    <input
      className={classNames(
        "rounded-md border text-sm font-normal outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60",
        textInputSizes[inputSize],
        fieldPadding[inputPadding],
        fieldBorders[borderTone],
        fieldSurfaces[surface],
        fieldTextTones[textTone],
        className,
      )}
      {...props}
    />
  );
}

type UiTextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  surface?: keyof typeof fieldSurfaces;
  borderTone?: keyof typeof fieldBorders;
  minHeight?: "sm" | "md" | "lg" | "xl" | "2xl";
  inputPadding?: keyof typeof fieldPadding | "mdBlock";
  textTone?: keyof typeof fieldTextTones;
  leading?: "normal" | "relaxed";
};

const textAreaMinHeights = {
  sm: "min-h-16",
  md: "min-h-20",
  lg: "min-h-24",
  xl: "min-h-28",
  "2xl": "min-h-32",
};

const textAreaPadding = {
  sm: "px-2 py-2",
  md: "p-3",
  mdBlock: "px-3 py-2",
};

const textAreaLeading = {
  normal: "",
  relaxed: "leading-6",
};

export function UiTextArea({ className, surface = "default", borderTone = "default", minHeight = "sm", inputPadding = "sm", textTone = "default", leading = "normal", ...props }: UiTextAreaProps) {
  return (
    <textarea
      className={classNames(
        "resize-y rounded-md border text-sm font-normal outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60",
        textAreaMinHeights[minHeight],
        textAreaPadding[inputPadding],
        fieldBorders[borderTone],
        fieldSurfaces[surface],
        fieldTextTones[textTone],
        textAreaLeading[leading],
        className,
      )}
      {...props}
    />
  );
}
