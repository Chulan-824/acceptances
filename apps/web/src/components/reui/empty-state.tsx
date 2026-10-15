// Composition adapted from https://reui.io/r/radix-nova/c-empty-1.json.
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../ui/empty";

export function EmptyState({
  title,
  description,
  actions,
  compact = false,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <Empty
      className={compact ? "p-3 md:p-3 gap-3" : undefined}
      data-reui="empty-state"
    >
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actions && <EmptyContent>{actions}</EmptyContent>}
    </Empty>
  );
}
