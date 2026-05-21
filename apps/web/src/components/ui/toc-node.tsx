import { cn, withRef } from "@udecode/cn";
import { useTocElement, useTocElementState } from "@platejs/toc/react";
import { PlateElement } from "platejs/react";

export const TocElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const state = useTocElementState();
    useTocElement(state);

    const headingList = state.headingList ?? [];

    return (
      <PlateElement
        ref={ref}
        className={cn("my-4 rounded-lg p-4", className)}
        {...props}
      >
        <div contentEditable={false}>
          {headingList.length > 0 ? (
            <nav>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                Table of Contents
              </h3>
              <ul className="m-0 list-none space-y-1 p-0">
                {headingList.map((heading) => (
                  <li
                    key={heading.id}
                    style={{
                      paddingLeft: `${(heading.depth - 1) * 16}px`,
                    }}
                  >
                    <button
                      type="button"
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm text-muted-foreground no-underline hover:text-foreground"
                      onClick={() => {
                        const element = document.getElementById(heading.id);
                        element?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      {heading.title}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add headings to create a table of contents.
            </p>
          )}
        </div>
        {children}
      </PlateElement>
    );
  },
);
