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

const paths: Record<IconName, ReactNode> = {
  "panel-left": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18m7-13-3 4 3 4" />
    </>
  ),
  "panel-right": (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18m-7-13 3 4-3 4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10m-7 6h4" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" />
    </>
  ),
  checks: (
    <path d="m3 6 2 2 3-4m3 3h10M3 13l2 2 3-4m3 3h10M3 20l2 2 3-4m3 3h10" />
  ),
  comment: (
    <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" />
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8m-8 4h6" />
    </>
  ),
  history: (
    <>
      <path d="M3 4v5h5" />
      <path d="M3 9a9 9 0 1 1 0 7m9-9v5l3 2" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
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
