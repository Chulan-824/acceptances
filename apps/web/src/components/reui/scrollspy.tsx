// Adapted from https://reui.io/r/radix-nova/scrollspy.json
// Local changes and upstream digest: docs/reui.md.
"use client";

import type { ReactNode, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

type ScrollspyProps = {
  children: ReactNode;
  targetRef?: RefObject<
    HTMLElement | HTMLDivElement | Document | null | undefined
  >;
  onUpdate?: (id: string) => void;
  offset?: number;
  smooth?: boolean;
  className?: string;
  dataAttribute?: string;
  history?: boolean;
};

export function Scrollspy({
  children,
  targetRef,
  onUpdate,
  className,
  offset = 0,
  smooth = true,
  dataAttribute = "scrollspy",
  history = true,
}: ScrollspyProps) {
  const selfRef = useRef<HTMLDivElement | null>(null);
  const anchorElementsRef = useRef<Element[] | null>(null);

  // Observing scroll only updates navigation state, never browser history.
  const setActiveSection = useCallback(
    (sectionId: string | null) => {
      if (!sectionId) return;
      anchorElementsRef.current?.forEach((item) => {
        const id = item.getAttribute(`data-${dataAttribute}-anchor`);
        if (id === sectionId) {
          item.setAttribute("data-active", "true");
          item.setAttribute("aria-current", "location");
        } else {
          item.removeAttribute("data-active");
          item.removeAttribute("aria-current");
        }
      });
      if (onUpdate) onUpdate(sectionId);
    },
    [dataAttribute, onUpdate],
  );

  const handleScroll = useCallback(() => {
    if (!anchorElementsRef.current || anchorElementsRef.current.length === 0)
      return;

    let scrollElement =
      targetRef?.current === document
        ? document.documentElement
        : (targetRef?.current as HTMLElement);

    if (!scrollElement) return;

    // If the scrollElement has a data-slot="scroll-area-viewport" inside, use that
    const viewport = scrollElement.querySelector(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport instanceof HTMLElement) {
      scrollElement = viewport;
    }

    const scrollTop =
      scrollElement === document.documentElement
        ? window.scrollY || document.documentElement.scrollTop
        : scrollElement.scrollTop;

    // Find the anchor whose section is closest to but not past the top
    let activeIdx = 0;
    let minDelta = Infinity;

    anchorElementsRef.current.forEach((anchor, idx) => {
      const sectionId = anchor.getAttribute(`data-${dataAttribute}-anchor`);
      const sectionElement = document.getElementById(sectionId!);
      if (!sectionElement) return;

      let customOffset = offset;
      const dataOffset = anchor.getAttribute(`data-${dataAttribute}-offset`);
      if (dataOffset) customOffset = parseInt(dataOffset, 10);

      const delta = Math.abs(
        sectionElement.offsetTop - customOffset - scrollTop,
      );

      if (
        sectionElement.offsetTop - customOffset <= scrollTop &&
        delta < minDelta
      ) {
        minDelta = delta;
        activeIdx = idx;
      }
    });

    // If at bottom, force last anchor
    const scrollHeight = (scrollElement as HTMLElement).scrollHeight;
    const clientHeight = (scrollElement as HTMLElement).clientHeight;

    if (scrollTop + clientHeight >= scrollHeight - 2) {
      activeIdx = anchorElementsRef.current.length - 1;
    }

    // Set only one anchor active and sync the URL hash
    const activeAnchor = anchorElementsRef.current[activeIdx];
    const sectionId =
      activeAnchor?.getAttribute(`data-${dataAttribute}-anchor`) || null;

    setActiveSection(sectionId);
  }, [anchorElementsRef, targetRef, dataAttribute, offset, setActiveSection]);

  const scrollTo = useCallback(
    (anchorElement: HTMLElement) => (event?: MouseEvent) => {
      if (
        event &&
        (event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          anchorElement.hasAttribute("download") ||
          (anchorElement.getAttribute("target") &&
            anchorElement.getAttribute("target") !== "_self"))
      )
        return;
      const sectionId =
        anchorElement
          .getAttribute(`data-${dataAttribute}-anchor`)
          ?.replace("#", "") || null;
      if (!sectionId) return;
      const sectionElement = document.getElementById(sectionId);
      if (!sectionElement) return;

      // Document links keep the browser's hash, focus, history and new-tab
      // behavior. CSS scroll-margin handles the fixed header offset.
      if (targetRef?.current === document) {
        setActiveSection(sectionId);
        return;
      }
      event?.preventDefault();

      let scrollToElement: HTMLElement | Window | null =
        targetRef?.current === document
          ? window
          : (targetRef?.current as HTMLElement);

      if (scrollToElement instanceof HTMLElement) {
        const viewport = scrollToElement.querySelector(
          '[data-slot="scroll-area-viewport"]',
        );
        if (viewport instanceof HTMLElement) {
          scrollToElement = viewport;
        }
      }

      let customOffset = offset;
      const dataOffset = anchorElement.getAttribute(
        `data-${dataAttribute}-offset`,
      );
      if (dataOffset) {
        customOffset = parseInt(dataOffset, 10);
      }

      const scrollTop = sectionElement.offsetTop - customOffset;

      if (scrollToElement && "scrollTo" in scrollToElement) {
        scrollToElement.scrollTo({
          top: scrollTop,
          left: 0,
          behavior:
            smooth &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "smooth"
              : "auto",
        });
      }
      if (event && history && window.location.hash !== `#${sectionId}`) {
        window.history.pushState(window.history.state, "", `#${sectionId}`);
      }
      setActiveSection(sectionId);
    },
    [dataAttribute, offset, smooth, targetRef, setActiveSection, history],
  );

  // Scroll to the section if the ID is present in the URL hash
  const scrollToHashSection = useCallback(() => {
    const hash = CSS.escape(window.location.hash.replace("#", ""));

    if (hash) {
      const targetElement = document.querySelector(
        `[data-${dataAttribute}-anchor="${hash}"]`,
      ) as HTMLElement;
      if (targetElement) {
        scrollTo(targetElement)();
      }
    }
  }, [dataAttribute, scrollTo]);

  useEffect(() => {
    // Query elements and store them in the ref, avoiding unnecessary re-renders
    if (selfRef.current) {
      anchorElementsRef.current = Array.from(
        selfRef.current.querySelectorAll<HTMLElement>(
          `[data-${dataAttribute}-anchor]`,
        ),
      );
    }

    const currentAnchors = anchorElementsRef.current;
    const listeners = currentAnchors?.map((item) => {
      if (!(item instanceof HTMLElement)) return () => {};
      const listener = scrollTo(item);
      item.addEventListener("click", listener);
      return () => item.removeEventListener("click", listener);
    });

    const onScroll = (event: Event) => {
      const scrollElement =
        targetRef?.current === document
          ? window
          : (targetRef?.current as HTMLElement);
      if (!scrollElement) return;

      if (
        scrollElement === window ||
        (scrollElement instanceof HTMLElement &&
          scrollElement.contains(event.target as Node))
      ) {
        handleScroll();
      }
    };

    // Use window listener with capture to catch scroll events from targetRef even if set later
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("hashchange", handleScroll);

    // Check if there's a hash in the URL and scroll to the corresponding section
    const initialTimeout = setTimeout(() => {
      scrollToHashSection();
      handleScroll();
    }, 100);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("hashchange", handleScroll);
      listeners?.forEach((remove) => remove());
      clearTimeout(initialTimeout);
    };
  }, [
    targetRef,
    selfRef,
    handleScroll,
    dataAttribute,
    scrollTo,
    scrollToHashSection,
  ]);

  return (
    <div data-slot="scrollspy" className={className} ref={selfRef}>
      {children}
    </div>
  );
}
