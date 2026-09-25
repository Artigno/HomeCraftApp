import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

interface UseSwipeToDeleteOptions {
  onDelete: () => void;
}

const REVEAL_THRESHOLD = 64;
const COMMIT_THRESHOLD = 120;
const CLICK_SUPPRESS_THRESHOLD = 8;

export function useSwipeToDelete({ onDelete }: UseSwipeToDeleteOptions) {
  const [translateX, setTranslateX] = useState(0);
  const [isRevealed, setIsRevealed] = useState(false);
  const dragging = useRef(false);
  const draggedFar = useRef(false);
  const startX = useRef(0);
  const startTranslate = useRef(0);

  const reset = useCallback(() => {
    setTranslateX(0);
    setIsRevealed(false);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      dragging.current = true;
      draggedFar.current = false;
      startX.current = e.clientX;
      startTranslate.current = translateX;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [translateX],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    const delta = e.clientX - startX.current;
    if (Math.abs(delta) > CLICK_SUPPRESS_THRESHOLD) draggedFar.current = true;
    const next = Math.min(0, Math.max(startTranslate.current + delta, -(COMMIT_THRESHOLD + 40)));
    setTranslateX(next);
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setTranslateX((current) => {
        if (current <= -COMMIT_THRESHOLD) {
          onDelete();
          return 0;
        }
        if (current <= -REVEAL_THRESHOLD) {
          setIsRevealed(true);
          return -REVEAL_THRESHOLD;
        }
        setIsRevealed(false);
        return 0;
      });
    },
    [onDelete],
  );

  const consumeDragFlag = useCallback(() => {
    const was = draggedFar.current;
    draggedFar.current = false;
    return was;
  }, []);

  return {
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    style: { transform: `translateX(${translateX}px)`, touchAction: "pan-y" as const },
    isRevealed,
    reset,
    consumeDragFlag,
  };
}
