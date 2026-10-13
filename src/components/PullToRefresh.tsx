import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TRIGGER_PX = 60;
const MAX_PULL_PX = 100;

export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const armedRef = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);
  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  // React attaches JSX onTouchMove as a passive listener, so e.preventDefault()
  // inside it is a silent no-op on iOS — the browser still owns the gesture and
  // nothing visibly happens. A pull-to-refresh drag has to block native scroll
  // mid-gesture, which only a manually-attached { passive: false } listener can do.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      armedRef.current = window.scrollY <= 0;
      startYRef.current = armedRef.current ? e.touches[0]!.clientY : null;
    }

    function onTouchMove(e: TouchEvent) {
      if (!armedRef.current || startYRef.current === null) return;
      const delta = e.touches[0]!.clientY - startYRef.current;
      if (delta <= 0) {
        setPull(0);
        return;
      }
      if (window.scrollY > 0) {
        armedRef.current = false;
        setPull(0);
        return;
      }
      e.preventDefault();
      setPull(Math.min(delta, MAX_PULL_PX));
    }

    function onTouchEnd() {
      armedRef.current = false;
      startYRef.current = null;
      if (pullRef.current >= TRIGGER_PX) {
        setRefreshing(true);
        setPull(TRIGGER_PX);
        void onRefresh().finally(() => {
          setRefreshing(false);
          setPull(0);
        });
      } else {
        setPull(0);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh]);

  const indicatorActive = pull > 0 || refreshing;

  return (
    <div
      ref={containerRef}
      style={{ touchAction: refreshing ? "none" : "pan-y", overscrollBehaviorY: "contain" }}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-[height] duration-150"
        style={{ height: indicatorActive ? Math.max(pull, refreshing ? TRIGGER_PX : 0) : 0 }}
      >
        <RefreshCw
          className={cn(
            "size-5 text-muted-foreground",
            refreshing ? "animate-spin" : "transition-transform",
          )}
          style={refreshing ? undefined : { transform: `rotate(${(pull / TRIGGER_PX) * 180}deg)` }}
        />
      </div>
      {children}
    </div>
  );
}
