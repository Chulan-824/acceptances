import {
  ChevronRight,
  Ellipsis,
  FileText,
  History,
  ListChecks,
  ListFilter,
  MessageSquare,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "./components/ui/dropdown-menu";
import { type ReactNode } from "react";

export type IconName =
  | "panel-left"
  | "panel-right"
  | "search"
  | "filter"
  | "more"
  | "refresh"
  | "checks"
  | "comment"
  | "file"
  | "history"
  | "chevron";

const icons: Record<IconName, LucideIcon> = {
  "panel-left": PanelLeftClose,
  "panel-right": PanelRightClose,
  search: Search,
  filter: ListFilter,
  more: Ellipsis,
  refresh: RefreshCw,
  checks: ListChecks,
  comment: MessageSquare,
  file: FileText,
  history: History,
  chevron: ChevronRight,
};

export function Icon({ name }: { name: IconName }) {
  const Glyph = icons[name];
  return <Glyph size={16} strokeWidth={1.6} aria-hidden="true" />;
}

export function ActionMenu({
  label,
  icon,
  className = "",
  children,
}: {
  label: string;
  icon: IconName;
  className?: string;
  children: ReactNode;
}) {
  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      className="icon-button"
      aria-label={label}
      title={label}
    >
      <Icon name={icon} />
    </Button>
  );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={`action-menu-content ${className}`}
        align="end"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PanelButton({
  side,
  collapsed,
  onClick,
}: {
  side: "left" | "right";
  collapsed: boolean;
  onClick: () => void;
}) {
  const name = side === "left" ? "需求列表" : "运行记录";
  const label = `${collapsed ? "展开" : "收起"}${name}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="icon-button"
          aria-label={`${collapsed ? "展开" : "收起"}${name}`}
          aria-expanded={!collapsed}
          onClick={onClick}
        >
          <Icon name={`panel-${side}`} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
