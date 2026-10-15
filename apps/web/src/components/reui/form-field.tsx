// Composition adapted from https://reui.io/r/radix-nova/c-field-2.json.
import type { ReactNode } from "react";
import { Field, FieldLabel, FieldDescription } from "../ui/field";
import { Alert } from "./alert";

export function FormField({
  id,
  label,
  description,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Field
      data-invalid={Boolean(error)}
      data-reui="form-field"
      className="gap-2"
    >
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description && (
        <FieldDescription id={`${id}-hint`} className="m-0">
          {description}
        </FieldDescription>
      )}
      {error && (
        <Alert id={`${id}-error`} variant="destructive">
          {error}
        </Alert>
      )}
    </Field>
  );
}
