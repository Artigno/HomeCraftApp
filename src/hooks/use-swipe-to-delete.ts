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
  const captured = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const startTranslate = useRef(0);

  const reset = useCallback(() => {
    setTranslateX(0);
    setIsRevealed(false);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      dragging.current = true;
      draggedFar.current = false;
      captured.current = false;
      startX.current = e.clientX;
      startY.current = e.clientY;
      startTranslate.current = translateX;
      // No setPointerCapture here — deferred to onPointerMove, once
      // horizontal movement actually confirms this is a swipe and not a
      // tap or a long-press-drag. Capturing eagerly on every pointerdown
      // redirects a child element's (checkbox, label) click synthesis to
      // this row regardless of how far the pointer ends up moving.
    },
    [translateX],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragging.current) return;
    const deltaX = e.clientX - startX.current;
    if (!captured.current) {
      const deltaY = e.clientY - startY.current;
      if (Math.abs(deltaX) <= CLICK_SUPPRESS_THRESHOLD) return; // not enough movement to tell yet
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return; // vertical-dominant — leave it to a long-press-drag, not a swipe
      captured.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    draggedFar.current = true;
    const next = Math.min(0, Math.max(startTranslate.current + deltaX, -(COMMIT_THRESHOLD + 40)));
    setTranslateX(next);
  }, []);

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (captured.current && e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      captured.current = false;
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
