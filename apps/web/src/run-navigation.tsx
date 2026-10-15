import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Run } from "@acceptances/api-client";

export interface RunNavigation {
  runPath: (id: string) => string;
  navigate: (path: string) => void;
}
type Tab = "checks" | "discussion" | "files";
type Target = { id?: string; malformed?: boolean };
function readTarget(): Target {
  try {
    return {
      id: location.hash
        ? decodeURIComponent(location.hash.slice(1))
        : undefined,
    };
  } catch {
    return { malformed: true };
  }
}
function resolveTab(run: Run, target: Target): Tab | undefined {
  const id = target.id;
  if (target.malformed) return;
  if (!id || id === "checks-title" || id === "report-top") return "checks";
  if (id === "run-feedback") return "discussion";
  if (id === "follow-up" && run.report.followUp) return "checks";
  if (run.report.checks.some((check) => `check-${check.id}` === id))
    return "checks";
  if (run.report.evidence?.some((item) => `evidence-${item.path}` === id))
    return "files";
  const review = run.reviews.find((review) => `feedback-${review.id}` === id);
  if (review) return review.checkId ? "checks" : "discussion";
}

const NavigationContext = createContext<RunNavigation | null>(null);
export const RunNavigationProvider = NavigationContext.Provider;

export function useRunNavigation(run: Run | undefined) {
  const [target, setTarget] = useState<Target>(readTarget);
  const [selectedTab, setTab] = useState<Tab>();
  const [checkQuery, setCheckQuery] = useState("");
  const [checkStatus, setCheckStatus] = useState("all");
  const [humanStatus, setHumanStatus] = useState("all");
  const reportTop = useRef<HTMLDivElement>(null);
  const targetNotice = useRef<HTMLDivElement>(null);
  // A snapshot can change without a new navigation intent. Consume an intent
  // only after its target is rendered and scrolled into view.
  const revealed = useRef<{
    runId: string;
    target: Target;
    missing: boolean;
  } | null>(null);
  const targetTab = run ? resolveTab(run, target) : undefined;
  const missingTarget = Boolean(run && targetTab === undefined);
  const tab = selectedTab || targetTab || "checks";
  function showTarget(id: string) {
    setTab(undefined);
    setCheckQuery("");
    setCheckStatus("all");
    setHumanStatus("all");
    setTarget({ id });
  }
  useEffect(() => {
    const followLocation = () => {
      setTab(undefined);
      setCheckQuery("");
      setCheckStatus("all");
      setHumanStatus("all");
      setTarget(readTarget());
    };
    window.addEventListener("hashchange", followLocation);
    window.addEventListener("popstate", followLocation);
    return () => {
      window.removeEventListener("hashchange", followLocation);
      window.removeEventListener("popstate", followLocation);
    };
  }, []);
  useEffect(() => {
    if (!run) return;
    if (
      revealed.current?.runId === run.id &&
      revealed.current.target === target &&
      revealed.current.missing === missingTarget
    )
      return;
    const element = missingTarget
      ? targetNotice.current
      : target.id === "report-top"
        ? reportTop.current
        : target.id
          ? document.getElementById(target.id)
          : null;
    if (!element) return;
    let ancestor: HTMLElement | null = element;
    while (ancestor) {
      if (ancestor.dataset.slot === "collapsible")
        ancestor.dispatchEvent(new Event("reveal-disclosure"));
      ancestor = ancestor.parentElement;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView();
      revealed.current = { runId: run.id, target, missing: missingTarget };
    });
    return () => cancelAnimationFrame(frame);
  }, [run, target, missingTarget]);
  function returnToOverview() {
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search,
    );
    showTarget("report-top");
  }
  return {
    tab,
    setTab,
    checkQuery,
    setCheckQuery,
    checkStatus,
    setCheckStatus,
    humanStatus,
    setHumanStatus,
    showTarget,
    missingTarget,
    returnToOverview,
    reportTop,
    targetNotice,
  };
}

export function RunLink({
  id,
  target,
  children,
}: {
  id: string;
  target?: string;
  children: ReactNode;
}) {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("RunLink requires RunNavigationProvider");
  const href = `${navigation.runPath(id)}${target ? `#${encodeURIComponent(target)}` : ""}`;
  return (
    <a
      href={href}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        if (new URL(href, location.href).href !== location.href)
          navigation.navigate(href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    >
      {children}
    </a>
  );
}
