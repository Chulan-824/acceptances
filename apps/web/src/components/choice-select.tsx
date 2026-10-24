import type { ComponentProps } from "react";
import { Select, SelectContent, SelectTrigger, SelectValue } from "./ui/select";

export function ChoiceSelect({
  children,
  className,
  "aria-label": label,
  ...props
}: ComponentProps<typeof Select> & {
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select {...props}>
      <SelectTrigger
        className={
          className ? `ui-select-trigger ${className}` : "ui-select-trigger"
        }
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {children}
      </SelectContent>
    </Select>
  );
}
