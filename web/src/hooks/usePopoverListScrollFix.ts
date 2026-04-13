import { useEffect, type RefObject } from "react";

/**
 * Radix Sheet/Dialog pode interceptar wheel; restaura scroll em listas dentro de Popover/portal.
 */
export function usePopoverListScrollFix(
  open: boolean,
  listRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation();
      e.preventDefault();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);
}
