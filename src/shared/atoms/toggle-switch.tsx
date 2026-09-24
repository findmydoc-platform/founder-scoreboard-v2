import { classNames } from "@/shared/atoms/ui-primitives";

export function ToggleSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={classNames(
        "inline-flex h-6 w-11 items-center rounded-full p-0.5 transition focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-blue-600" : "bg-slate-300",
      )}
    >
      <span className={classNames("h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}
