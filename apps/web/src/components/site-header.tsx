import type { MouseEventHandler, ReactNode } from "react";

export function SiteHeader({
  children,
  context = "交付验证系统",
  brandHref = "/",
  onBrandClick,
  brandExtra,
}: {
  children?: ReactNode;
  context?: string;
  brandHref?: string;
  onBrandClick?: MouseEventHandler<HTMLAnchorElement>;
  brandExtra?: ReactNode;
}) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <div className="site-header-identity">
          <a className="site-brand" href={brandHref} onClick={onBrandClick}>
            <span className="site-brand-mark" aria-hidden="true">
              A
            </span>
            <span>Acceptances</span>
            <span className="site-brand-context">{context}</span>
          </a>
          {brandExtra}
        </div>
        <div className="site-header-actions">{children}</div>
      </div>
    </header>
  );
}
