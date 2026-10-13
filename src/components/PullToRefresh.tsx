import { RefreshCw } from "lucide-react";
import { useRef, useState, type ReactNode, type TouchEvent } from "react";
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
  const startYRef = useRef<number | null>(null);
  const armedRef = useRef(false);

  function onTouchStart(e: TouchEvent<HTMLDivElement>) {
    if (refreshing) return;
    // Only arm the gesture when the page is already scrolled to the top —
    // otherwise an ordinary upward scroll-then-overshoot would trigger it.
    armedRef.current = window.scrollY <= 0;
    startYRef.current = armedRef.current ? e.touches[0]!.clientY : null;
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (!armedRef.current || startYRef.current === null) return;
    const delta = e.touches[0]!.clientY - startYRef.current;
    if (delta <= 0) {
      setPull(0);
      return;
    }
    // Only take over the gesture once the page is confirmed pinned to the
    // top — prevents fighting the browser's own scroll on the way there.
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
    if (pull >= TRIGGER_PX) {
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

  const indicatorActive = pull > 0 || refreshing;

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
