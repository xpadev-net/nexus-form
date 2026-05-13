import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ModeToggle } from "./mode-toggle";
import { isNavItemActive, navigationItems } from "./navigation";

export function NavigationDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label="メニューを開く"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 gap-0 p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">ナビゲーション</SheetTitle>
            <SheetDescription className="sr-only">
              サイトナビゲーションメニュー
            </SheetDescription>
          </SheetHeader>

          <nav className="flex flex-col gap-1 p-2">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = isNavItemActive(item.href, pathname);

              return (
                <Button
                  key={item.name}
                  asChild
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => setOpen(false)}
                >
                  <Link to={item.href}>
                    <Icon className="h-4 w-4" />
                    <span>{item.name}</span>
                  </Link>
                </Button>
              );
            })}
          </nav>

          <div className="mt-auto border-t px-4 py-3">
            <ModeToggle />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
