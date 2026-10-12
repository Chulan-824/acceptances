import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-primary",
      destructive: "ui-button-destructive",
      outline: "ui-button-outline",
      secondary: "",
      ghost: "ui-button-ghost",
      link: "ui-button-link",
    },
    size: {
      default: "",
      sm: "ui-button-sm",
      lg: "ui-button-lg",
      icon: "ui-button-icon",
      "icon-sm": "ui-button-icon",
    },
  },
  defaultVariants: { variant: "secondary", size: "default" },
});

function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
