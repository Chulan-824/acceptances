import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { cn } from "../lib/utils";

// 共用折叠交互，深链接可以展开检查项及其评审历史。
export function Disclosure({
  title,
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  triggerClassName,
  triggerRef,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, "title"> & {
  title: ReactNode;
  triggerClassName?: string;
  triggerRef?: React.Ref<HTMLButtonElement>;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const open = controlledOpen ?? localOpen;
  function change(value: boolean) {
    setLocalOpen(value);
    onOpenChange?.(value);
  }
  useEffect(() => {
    const element = root.current;
    const reveal = () => {
      setLocalOpen(true);
      onOpenChange?.(true);
    };
    element?.addEventListener("reveal-disclosure", reveal);
    return () => element?.removeEventListener("reveal-disclosure", reveal);
  }, [onOpenChange]);
  return (
    <Collapsible
      ref={root}
      open={open}
      onOpenChange={change}
      disabled={disabled}
      {...props}
    >
      <CollapsibleTrigger
        ref={triggerRef}
        className={cn("disclosure-trigger", triggerClassName)}
      >
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent forceMount>{children}</CollapsibleContent>
    </Collapsible>
  );
}
