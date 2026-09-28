import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_THRESHOLD = 10;

/** Fires onLongPress after holding, and suppresses the click that follows it. */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedLongPress = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      firedLongPress.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        firedLongPress.current = true;
        if ("vibrate" in navigator) navigator.vibrate(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clear, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const dx = Math.abs(e.clientX - start.current.x);
      const dy = Math.abs(e.clientY - start.current.y);
      if (dx > MOVE_CANCEL_THRESHOLD || dy > MOVE_CANCEL_THRESHOLD) clear();
    },
    [clear],
  );

  /** Call from onClick; returns true (and swallows the click) if a long-press just fired. */
  const consumeLongPress = useCallback(() => {
    const fired = firedLongPress.current;
    firedLongPress.current = false;
    return fired;
  }, []);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: clear,
      onPointerCancel: clear,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
    consumeLongPress,
  };
}
