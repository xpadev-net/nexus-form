import { useEffect } from "react";
import { brandConfig } from "@/lib/brand-config";

export function usePageTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ${brandConfig.appName}`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
