"use client";

import { useId, type ReactNode } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect, type CustomSelectOption } from "@/shared/atoms/custom-select";
import { UiField } from "@/shared/atoms/ui-primitives";

type UiSelectFieldProps = {
  label: ReactNode;
  value: string | number;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  selectClassName?: string;
  menuClassName?: string;
  "aria-label"?: string;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "data-autofocus"?: boolean;
  children?: ReactNode;
};

export function UiSelectField({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  selectClassName = "h-9 text-sm",
  menuClassName,
  "aria-label": ariaLabel,
  "aria-required": ariaRequired,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "data-autofocus": dataAutofocus,
  children,
}: UiSelectFieldProps) {
  const labelId = useId();

  return (
    <UiField as="div" className={className}>
      <span id={labelId}>{label}</span>
      <CustomSelect
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={selectClassName}
        menuClassName={menuClassName}
        options={options}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelId}
        aria-required={ariaRequired}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        data-autofocus={dataAutofocus}
      />
      {children}
    </UiField>
  );
}

type UiDateFieldProps = {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  pickerClassName?: string;
  "aria-label"?: string;
};

export function UiDateField({
  label,
  value,
  onChange,
  disabled,
  className,
  pickerClassName = "h-9 text-sm",
  "aria-label": ariaLabel,
}: UiDateFieldProps) {
  const labelId = useId();

  return (
    <UiField as="div" className={className}>
      <span id={labelId}>{label}</span>
      <CustomDatePicker
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={pickerClassName}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelId}
      />
    </UiField>
  );
}
