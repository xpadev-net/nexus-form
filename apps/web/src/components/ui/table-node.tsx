import { cn, withRef } from "@udecode/cn";
import { useTableColSizes } from "@platejs/table/react";
import type { TTableElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";

export const TableElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TTableElement>();
    const colSizes = useTableColSizes();

    return (
      <PlateElement
        ref={ref}
        as="table"
        className={cn(
          "my-4 ml-px mr-0 table h-px w-full table-fixed border-collapse",
          className,
        )}
        {...props}
      >
        <colgroup>
          {colSizes.map((width: number, index: number) => (
            <col
              key={`col-${element.id ?? index}`}
              className={cn(!width && "min-w-[48px]")}
              style={width ? { width } : undefined}
            />
          ))}
        </colgroup>
        <tbody className="min-w-full">{children}</tbody>
      </PlateElement>
    );
  },
);

export const TableRowElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="tr"
      className={cn("h-full", className)}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const TableCellElement = withRef<typeof PlateElement>(
  ({ children, className, style, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="td"
      className={cn(
        "relative h-full min-w-[48px] overflow-visible border border-border bg-background p-3 align-top",
        "has-[data-slate-placeholder]:pb-0",
        className,
      )}
      style={style}
      {...props}
    >
      <div className="relative z-20">{children}</div>
    </PlateElement>
  ),
);

export const TableCellHeaderElement = withRef<typeof PlateElement>(
  ({ children, className, style, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="th"
      className={cn(
        "relative h-full min-w-[48px] overflow-visible border border-border bg-muted/50 p-3 text-left align-top font-semibold",
        "has-[data-slate-placeholder]:pb-0",
        className,
      )}
      style={style}
      {...props}
    >
      <div className="relative z-20">{children}</div>
    </PlateElement>
  ),
);
