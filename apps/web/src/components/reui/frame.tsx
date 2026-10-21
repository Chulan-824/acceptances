// Adapted from https://reui.io/r/radix-nova/frame.json.
// Modern Slate variants and the upstream digest are documented in docs/reui.md.
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const frameVariants = cva("reui-frame", {
  variants: {
    variant: {
      default: "reui-frame-default",
      inverse: "reui-frame-inverse",
      ghost: "reui-frame-ghost",
    },
    spacing: {
      none: "reui-frame-spacing-none",
      xs: "reui-frame-spacing-xs",
      sm: "reui-frame-spacing-sm",
      default: "reui-frame-spacing-default",
      lg: "reui-frame-spacing-lg",
    },
    stacked: { true: "reui-frame-stacked", false: "" },
    dense: { true: "reui-frame-dense", false: "" },
  },
  defaultVariants: {
    variant: "default",
    spacing: "default",
    stacked: false,
    dense: false,
  },
});

function Frame({
  className,
  asChild = false,
  variant,
  spacing = "default",
  stacked,
  dense,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof frameVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      className={cn(
        frameVariants({ variant, spacing, stacked, dense }),
        className,
      )}
      data-slot="frame"
      data-spacing={spacing}
      {...props}
    />
  );
}

const panelVariants = cva("reui-panel", {
  variants: {
    variant: {
      default: "",
      flat: "reui-panel-flat",
      outline: "reui-panel-outline",
      subtle: "reui-panel-subtle",
      divider: "reui-panel-divider",
    },
    fit: { true: "", false: "grow" },
  },
  defaultVariants: { variant: "default", fit: false },
});

function FramePanel({
  className,
  variant,
  fit,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof panelVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      className={cn(panelVariants({ variant, fit }), className)}
      data-slot="frame-panel"
      {...props}
    />
  );
}

function FrameHeader({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"header"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "header";
  return (
    <Comp
      className={cn("reui-frame-header", className)}
      data-slot="frame-panel-header"
      {...props}
    />
  );
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-sm font-medium", className)}
      data-slot="frame-panel-title"
      {...props}
    />
  );
}

function FrameDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="frame-panel-description"
      {...props}
    />
  );
}

function FrameFooter({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"footer"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "footer";
  return (
    <Comp
      className={cn("reui-frame-footer", className)}
      data-slot="frame-panel-footer"
      {...props}
    />
  );
}

export {
  Frame,
  FramePanel,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FrameFooter,
  frameVariants,
};
