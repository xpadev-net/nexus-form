import { cn, withRef } from "@udecode/cn";
import { Toolbar } from "@radix-ui/react-toolbar";

export const FixedToolbar = withRef<typeof Toolbar>(
  ({ children, className, ...props }, ref) => (
    <Toolbar
      ref={ref}
      className={cn(
        "sticky top-0 z-50 w-full overflow-x-auto rounded-t-lg border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "scrollbar-hide flex min-h-[40px] flex-wrap items-center gap-1 px-2 py-1",
        className,
      )}
      {...props}
    >
      {children}
    </Toolbar>
  ),
);
