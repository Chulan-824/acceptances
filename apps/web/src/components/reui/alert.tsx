// Adapted from https://reui.io/r/radix-nova/alert.json
// Local changes and upstream digest: docs/reui.md.
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  [
    "ui-alert relative w-full has-[>svg]:grid-cols-[calc(var(--spacing)*3)_1fr] grid-cols-[0_1fr] grid gap-y-0.5 items-center [&>svg:not([class*=size-])]:size-4",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:[&_[data-slot=alert-action]]:sm:row-end-3",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:items-start",
    "has-[>[data-slot=alert-title]+[data-slot=alert-description]]:[&_svg]:translate-y-0.5",
    "has-[>svg]:gap-x-2.5",
  ],
  {
    variants: {
      variant: {
        default: "border-0 bg-warning-soft",
        destructive:
          "ui-alert-destructive border border-danger-border bg-danger-soft text-danger-dark",
        info: "border-border bg-surface-subtle text-fg-secondary",
        success: "border-accent-border bg-accent-soft text-accent-dark",
        warning: "border-warning-border bg-warning-soft text-warning-dark",
        invert: "border-brand bg-brand text-brand-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-reui="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <AlertDescription>{children}</AlertDescription>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-inherit col-start-2 grid justify-items-start gap-1 text-sm",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "flex gap-1.5 max-sm:col-start-2 max-sm:mt-2 max-sm:justify-start sm:col-start-3 sm:row-start-1 sm:justify-end sm:self-center",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
