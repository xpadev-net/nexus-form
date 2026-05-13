import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Settings, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./mode-toggle";

export const navigationItems = [
  {
    name: "ホーム",
    href: "/",
    icon: Home,
  },
  {
    name: "APIトークン",
    href: "/tokens",
    icon: Shield,
  },
  {
    name: "設定",
    href: "/settings",
    icon: Settings,
  },
];

export function isNavItemActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Navigation() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="flex items-center justify-between w-full">
      <nav className="flex items-center space-x-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = isNavItemActive(item.href, pathname);

          return (
            <Button
              key={item.name}
              asChild
              variant={isActive ? "default" : "ghost"}
              size="sm"
              className="flex items-center space-x-2"
            >
              <Link to={item.href}>
                <Icon className="h-4 w-4" />
                <span>{item.name}</span>
              </Link>
            </Button>
          );
        })}
      </nav>
      <div className="flex items-center space-x-2">
        <ModeToggle />
      </div>
    </div>
  );
}
