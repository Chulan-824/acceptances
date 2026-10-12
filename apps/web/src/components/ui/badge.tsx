import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

const badgeVariants = cva("badge", {
  variants: {
    variant: {
      default: "",
      secondary: "",
      destructive: "failed",
      outline: "ui-badge-outline",
      passed: "passed",
      failed: "failed",
      blocked: "blocked",
      skipped: "skipped",
      accepted: "accepted",
      rejected: "rejected",
      pending: "pending",
      void: "void",
      comment: "comment",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
