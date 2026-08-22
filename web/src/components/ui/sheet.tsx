import * as React from "react"
import { Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { readSheetMaximized, writeSheetMaximized } from "@/lib/sheetUiPrefs"
import { cn } from "@/lib/utils"

const STACKED_LAYER_SELECTOR = [
  "[data-slot='sheet-content']",
  "[data-slot='sheet-overlay']",
  "[data-slot='dialog-content']",
  "[data-slot='dialog-overlay']",
  "[data-slot='alert-dialog-content']",
  "[data-slot='alert-dialog-overlay']",
].join(",")

function outsideEventTarget(event: Event): EventTarget | null {
  if ("detail" in event) {
    const original = (event as CustomEvent<{ originalEvent?: Event }>).detail
      ?.originalEvent
    if (original?.target) return original.target
  }
  return event.target
}

function isForeignStackedLayer(
  target: EventTarget | null,
  roots: Array<HTMLElement | null>,
) {
  if (!(target instanceof Element)) return false
  if (roots.some((root) => root?.contains(target))) return false
  const layer = target.closest(STACKED_LAYER_SELECTOR)
  if (!(layer instanceof Element)) return false
  return !roots.some((root) => root && (root === layer || root.contains(layer)))
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

const sheetControlButtonClassName =
  "rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"

function SheetContent({
  className,
  overlayClassName,
  children,
  side = "right",
  showCloseButton = true,
  maximizable = false,
  onOpenAutoFocus,
  onPointerDownOutside,
  onFocusOutside,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  overlayClassName?: string
  maximizable?: boolean
}) {
  const [maximized, setMaximized] = React.useState(readSheetMaximized)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const overlayRef = React.useRef<HTMLDivElement | null>(null)

  const setMaximizedAndPersist = React.useCallback((next: boolean) => {
    setMaximized(next)
    writeSheetMaximized(next)
  }, [])

  const preventStackedDismiss = React.useCallback((event: Event) => {
    if (
      isForeignStackedLayer(outsideEventTarget(event), [
        contentRef.current,
        overlayRef.current,
      ])
    ) {
      event.preventDefault()
    }
  }, [])

  return (
    <SheetPortal>
      <SheetOverlay ref={overlayRef} className={overlayClassName} />
      <SheetPrimitive.Content
        {...props}
        ref={contentRef}
        data-slot="sheet-content"
        data-maximized={maximized ? "true" : undefined}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition-[max-width,width] ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500 px-4",
          side === "right" &&
            "inset-y-0 right-0 h-full min-h-0 w-full overflow-y-auto border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          side === "left" &&
            "inset-y-0 left-0 h-full min-h-0 w-full overflow-y-auto border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
          (side === "right" || side === "left") &&
            "md:w-[70vw] md:!max-w-[70vw]",
          maximizable &&
            maximized &&
            (side === "right" || side === "left") &&
            "md:!w-[min(100vw-1rem,90rem)] md:!max-w-[min(100vw-1rem,90rem)]"
        )}
        onOpenAutoFocus={(event) => {
          setMaximized(readSheetMaximized())
          onOpenAutoFocus?.(event)
        }}
        onPointerDownOutside={(event) => {
          preventStackedDismiss(event)
          onPointerDownOutside?.(event)
        }}
        onFocusOutside={(event) => {
          preventStackedDismiss(event)
          onFocusOutside?.(event)
        }}
        onInteractOutside={(event) => {
          preventStackedDismiss(event)
          onInteractOutside?.(event)
        }}
      >
        {children}
        {(maximizable || showCloseButton) && (
          <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
            {maximizable && (side === "right" || side === "left") && (
              <button
                type="button"
                className={sheetControlButtonClassName}
                aria-label={maximized ? "Minimizar" : "Maximizar"}
                onClick={() => setMaximizedAndPersist(!maximized)}
              >
                {maximized ? (
                  <Minimize2Icon className="size-4" />
                ) : (
                  <Maximize2Icon className="size-4" />
                )}
              </button>
            )}
            {showCloseButton && (
              <SheetPrimitive.Close
                className={cn(
                  sheetControlButtonClassName,
                  "data-[state=open]:bg-secondary"
                )}
              >
                <XIcon className="size-4" />
                <span className="sr-only">Close</span>
              </SheetPrimitive.Close>
            )}
          </div>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex shrink-0 flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-display font-semibold tracking-[-0.01em] text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
