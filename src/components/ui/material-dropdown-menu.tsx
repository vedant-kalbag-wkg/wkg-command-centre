"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

// --- DUAL-PHYSICS RIPPLE ENGINE ---
const MINIMUM_PRESS_MS = 300;

type RippleVariant = "trigger" | "item";

const useInternalRipple = ({ disabled = false, variant = "item" }: { disabled?: boolean, variant?: RippleVariant } = {}) => {
  const [pressed, setPressed] = React.useState(false);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const rippleRef = React.useRef<HTMLDivElement>(null);
  const growAnimationRef = React.useRef<Animation | null>(null);
  const isMounted = React.useRef(true);

  React.useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  },[]);

  const startPressAnimation = (event?: React.PointerEvent | React.KeyboardEvent) => {
    if (disabled || !surfaceRef.current || !rippleRef.current) return;

    const rect = surfaceRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    setPressed(true);
    growAnimationRef.current?.cancel();

    let clickX = rect.width / 2;
    let clickY = rect.height / 2;

    if (event && "clientX" in event) {
      clickX = (event as React.PointerEvent).clientX - rect.left;
      clickY = (event as React.PointerEvent).clientY - rect.top;
    }

    if (variant === "trigger") {
      const maxDistance = Math.max(
        Math.hypot(clickX, clickY),
        Math.hypot(rect.width - clickX, clickY),
        Math.hypot(clickX, rect.height - clickY),
        Math.hypot(rect.width - clickX, rect.height - clickY)
      );
      const finalRadius = maxDistance / 0.65;
      const finalSize = finalRadius * 2;
      const initialScale = Math.min(10 / finalSize, 0.04);
      const surfaceArea = rect.width * rect.height;
      const areaDuration = Math.sqrt(surfaceArea) * 3;
      const duration = Math.min(Math.max(600, areaDuration), 1000);

      rippleRef.current.style.width = `${finalSize}px`;
      rippleRef.current.style.height = `${finalSize}px`;

      const left = clickX - finalRadius;
      const top = clickY - finalRadius;
      const centerLeft = (rect.width - finalSize) / 2;
      const centerTop = (rect.height - finalSize) / 2;

      growAnimationRef.current = rippleRef.current.animate(
        [
          { transform: `translate(${left}px, ${top}px) scale(${initialScale})` },
          { transform: `translate(${centerLeft}px, ${centerTop}px) scale(1)` },
        ],
        { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }
      );
    } else {
      const maxDim = Math.max(rect.width, rect.height);
      const softEdgeSize = Math.max(0.35 * maxDim, 75);
      const initialSize = Math.max(2, Math.floor(maxDim * 0.2));
      const hypotenuse = Math.sqrt(rect.width ** 2 + rect.height ** 2);
      const maxRadius = hypotenuse + 10;
      const duration = Math.min(Math.max(400, hypotenuse * 1.5), 1000);
      const scale = (maxRadius + softEdgeSize) / initialSize;

      rippleRef.current.style.width = `${initialSize}px`;
      rippleRef.current.style.height = `${initialSize}px`;

      const startX = clickX - initialSize / 2;
      const startY = clickY - initialSize / 2;
      const endX = (rect.width - initialSize) / 2;
      const endY = (rect.height - initialSize) / 2;

      growAnimationRef.current = rippleRef.current.animate(
        [
          { transform: `translate(${startX}px, ${startY}px) scale(1)` },
          { transform: `translate(${endX}px, ${endY}px) scale(${scale})` },
        ],
        { duration, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "forwards" }
      );
    }
  };

  const endPressAnimation = async () => {
    const animation = growAnimationRef.current;
    if (animation && typeof animation.currentTime === "number" && animation.currentTime < MINIMUM_PRESS_MS) {
      await new Promise((r) => setTimeout(r, MINIMUM_PRESS_MS - (animation.currentTime as number)));
    }
    if (isMounted.current) setPressed(false);
  };

  return {
    surfaceRef, rippleRef, pressed,
    events: {
      onPointerDown: (e: React.PointerEvent) => { if (e.button === 0) startPressAnimation(e); },
      onPointerUp: endPressAnimation,
      onPointerLeave: endPressAnimation,
      onPointerCancel: endPressAnimation,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          startPressAnimation();
          setTimeout(endPressAnimation, MINIMUM_PRESS_MS);
        }
      },
    },
  };
};

const RippleLayer = ({ pressed, rippleRef, variant = "item" }: { pressed: boolean; rippleRef: React.RefObject<HTMLDivElement | null>; variant?: RippleVariant }) => (
  <div className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none z-0">
    <div className="absolute inset-0 bg-current opacity-0 transition-opacity duration-200 group-hover:opacity-[0.08] group-data-[highlighted]:opacity-[0.08]" />
    <div
      ref={rippleRef}
      className="absolute rounded-full opacity-0 bg-current"
      style={{
        background: variant === "trigger"
            ? "radial-gradient(closest-side, currentColor 65%, transparent 100%)"
            : "radial-gradient(closest-side, currentColor max(calc(100% - 70px), 65%), transparent 100%)",
        transition: "opacity 375ms linear",
        opacity: pressed ? "0.12" : "0",
        transitionDuration: pressed ? "100ms" : "375ms",
        top: 0,
        left: 0,
      }}
    />
  </div>
);

// --- SSR COMPATIBLE CINEMATIC STYLES ---
const M3Styles = () => (
  <style id="m3-dropdown-styles" dangerouslySetInnerHTML={{ __html: `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes m3-sweep-down { 0% { clip-path: inset(0 0 100% 0 round 12px); } 100% { clip-path: inset(0 0 0 0 round 12px); } }
      @keyframes m3-sweep-up { 0% { clip-path: inset(100% 0 0 0 round 12px); } 100% { clip-path: inset(0 0 0 0 round 12px); } }
      @keyframes m3-item-cinematic {
        0% { opacity: 0; transform: translateY(8px) scale(0.98); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes m3-item-exit {
        0% { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(4px) scale(0.95); }
      }
      .m3-content[data-state="open"] { opacity: 1; }
      .m3-content[data-state="closed"] { opacity: 0; transition: opacity 200ms linear; }
      .m3-content[data-state="open"][data-side="bottom"] { animation: m3-sweep-down 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }
      .m3-content[data-state="open"][data-side="top"] { animation: m3-sweep-up 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }
      .m3-content[data-state="open"] .m3-item-enter { opacity: 0; animation: m3-item-cinematic 350ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; animation-delay: calc(var(--m3-stagger, 0) * 30ms + 40ms); }
      .m3-content[data-state="closed"] .m3-item-enter { animation: m3-item-exit 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
    }
  `}} />
);

// --- EXPORTED COMPONENTS ---

const M3DropdownMenu = DropdownMenuPrimitive.Root;

const M3DropdownMenuTrigger = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ children, className, ...props }, ref) => {
  const { surfaceRef, rippleRef, pressed, events } = useInternalRipple({ variant: "trigger" });

  return (
    <DropdownMenuPrimitive.Trigger ref={ref} asChild {...props}>
      <button className={cn("group relative overflow-hidden outline-none flex items-center justify-center rounded-full transition-all", className)} {...events}>
        <RippleLayer rippleRef={rippleRef} pressed={pressed} variant="trigger" />
        <span ref={surfaceRef as React.RefObject<HTMLSpanElement>} className="absolute inset-0 z-0" />
        <div className="relative z-10 flex w-full h-full items-center justify-center pointer-events-none">
          {children}
        </div>
      </button>
    </DropdownMenuPrimitive.Trigger>
  );
});
M3DropdownMenuTrigger.displayName = "M3DropdownMenuTrigger";

const M3DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 8, children, ...props }, ref) => {
  const staggeredChildren = React.Children.map(children, (child, index) => {
    if (React.isValidElement<{ style?: React.CSSProperties }>(child)) return React.cloneElement(child, { style: { ...child.props.style, "--m3-stagger": index } as React.CSSProperties });
    return child;
  });

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "m3-content z-50 rounded-xl bg-popover/95 backdrop-blur-xl text-popover-foreground shadow-[0px_8px_32px_rgba(0,0,0,0.12)] border border-border/20 outline-none overflow-hidden relative py-0 min-w-[220px]",
          "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
          className
        )}
        {...props}
      >
        <M3Styles />
        {staggeredChildren}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
});
M3DropdownMenuContent.displayName = "M3DropdownMenuContent";

const M3DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean; delayDuration?: number; enterAnimation?: boolean
  }
>(({ className, inset, children, delayDuration = 250, enterAnimation = true, ...props }, ref) => {
  const { surfaceRef, rippleRef, pressed, events } = useInternalRipple({ disabled: props.disabled, variant: "item" });

  const handleSelect = (e: Event) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail = (e as any)?.detail;
    const isKeyboard = detail?.originalEvent?.type === "keydown";
    if (delayDuration > 0 && !isKeyboard) {
      e.preventDefault();
      setTimeout(() => props.onSelect?.(e), delayDuration);
    } else {
      props.onSelect?.(e);
    }
  };

  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "group relative flex cursor-pointer select-none items-stretch px-0 min-h-[48px] text-sm font-medium tracking-[0.01em] outline-none transition-colors",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-40 overflow-hidden rounded-none",
        enterAnimation && "m3-item-enter",
        className
      )}
      {...events}
      {...props}
      onSelect={handleSelect}
    >
      <div
        ref={(node) => { (surfaceRef as React.MutableRefObject<HTMLDivElement | null>).current = node; }}
        className={cn("relative flex flex-1 items-center px-4", inset && "pl-12")}
      >
        <RippleLayer rippleRef={rippleRef} pressed={pressed} variant="item" />
        <span className="relative z-10 flex w-full items-center gap-3 pointer-events-none">{children}</span>
      </div>
    </DropdownMenuPrimitive.Item>
  );
});
M3DropdownMenuItem.displayName = "M3DropdownMenuItem";

const M3DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn(
      "h-[1px] w-full m3-item-enter my-0",
      "bg-gradient-to-r from-transparent via-border to-transparent opacity-80 my-0.5",
      className
    )}
    {...props}
  />
));
M3DropdownMenuSeparator.displayName = "M3DropdownMenuSeparator";

const M3DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-5 py-4 text-[10px] font-black tracking-[0.15em] text-primary/80 uppercase m3-item-enter", inset && "pl-12", className)}
    {...props}
  />
));
M3DropdownMenuLabel.displayName = "M3DropdownMenuLabel";

const M3DropdownMenuGroup = DropdownMenuPrimitive.Group;

export {
  M3DropdownMenu,
  M3DropdownMenuTrigger,
  M3DropdownMenuContent,
  M3DropdownMenuItem,
  M3DropdownMenuSeparator,
  M3DropdownMenuLabel,
  M3DropdownMenuGroup,
};
