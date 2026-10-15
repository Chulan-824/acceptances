// Adapted from https://reui.io/r/radix-nova/badge.json
// Local changes and upstream digest: docs/reui.md.
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "badge relative inline-flex shrink-0 items-center justify-center w-fit border border-transparent whitespace-nowrap outline-none transition-shadow",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3",
  ],
  {
    variants: {
      variant: {
        default: "border-0",
        outline: "border-border bg-transparent dark:bg-input/32",
        secondary: "border-0",
        info: "bg-brand text-white",
        success: "bg-accent text-white",
        warning: "bg-warning text-white",
        destructive: "bg-destructive text-white",
        focus: "bg-brand text-brand-fg",
        invert: "bg-brand text-brand-fg",
        "primary-light":
          "border-primary/10 bg-primary/10 text-primary dark:border-primary/25 dark:bg-primary/15 dark:text-primary",
        "warning-light":
          "border-warning/15 bg-warning/10 text-warning-dark dark:border-warning/25 dark:bg-warning/15 dark:text-warning",
        "success-light":
          "border-accent/15 bg-accent/10 text-accent-dark dark:border-accent/25 dark:bg-accent/15 dark:text-accent",
        "info-light":
          "border-brand/15 bg-brand/10 text-brand-fg dark:border-brand/25 dark:bg-brand/15 dark:text-brand",
        "destructive-light":
          "border-destructive/15 bg-destructive/10 text-danger-dark dark:border-destructive/25 dark:bg-destructive/15 dark:text-destructive",
        "invert-light":
          "border-brand/15 bg-brand/10 text-foreground dark:border-brand/45 dark:bg-brand/35 dark:text-brand-fg",
        "focus-light":
          "border-brand/15 bg-brand/10 text-brand-fg dark:border-brand/25 dark:bg-brand/15 dark:text-brand",
        "primary-outline":
          "bg-background border-border text-primary dark:bg-input/30",
        "warning-outline":
          "bg-background border-border text-warning-dark dark:bg-input/30",
        "success-outline":
          "bg-background border-border text-accent-dark dark:bg-input/30",
        "info-outline":
          "bg-background border-border text-brand-fg dark:bg-input/30",
        "destructive-outline":
          "bg-background border-border text-danger-dark dark:bg-input/30",
        "invert-outline":
          "bg-background border-border text-brand-fg dark:bg-input/30",
        "focus-outline":
          "bg-background border-border text-brand-fg dark:bg-input/30",
      },
      size: {
        xs: "px-1 py-0.25 text-[0.6rem] leading-none h-4 min-w-4 gap-1",
        sm: "px-1 py-0.25 text-[0.625rem] leading-none h-4.5 min-w-4.5 gap-1",
        default: "",
        lg: "px-1.5 py-0.5 text-xs h-5.5 min-w-5.5 gap-1",
        xl: "px-2 py-0.75 text-sm h-6 min-w-6 gap-1.5",
      },
      /** `default`: active style radius. `full`: pill radius. */
      radius: {
        default: "rounded-sm",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "default",
    },
  },
);

interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({
  className,
  variant,
  size,
  radius,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-reui="badge"
      className={cn(badgeVariants({ variant, size, radius, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants, type BadgeProps };
