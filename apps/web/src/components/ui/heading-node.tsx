import { cn, withRef } from "@udecode/cn";
import { PlateElement } from "platejs/react";

export const H1Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h1"
      className={cn(
        "mb-1 mt-[2em] px-0 py-1 text-4xl font-bold",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const H2Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h2"
      className={cn(
        "mb-1 mt-[1.4em] px-0 py-1 text-2xl font-semibold tracking-tight",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const H3Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h3"
      className={cn(
        "mb-1 mt-[1em] px-0 py-1 text-xl font-semibold tracking-tight",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const H4Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h4"
      className={cn(
        "mb-1 mt-[0.75em] px-0 py-1 text-lg font-semibold tracking-tight",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const H5Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h5"
      className={cn(
        "mb-1 mt-[0.75em] px-0 py-1 text-base font-semibold tracking-tight",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const H6Element = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="h6"
      className={cn(
        "mb-1 mt-[0.75em] px-0 py-1 text-sm font-semibold tracking-tight",
        "first:mt-0",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);
