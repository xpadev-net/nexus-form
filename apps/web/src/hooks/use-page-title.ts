import { useEffect } from "react";
import { brandConfig } from "@/lib/brand-config";

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} | ${brandConfig.appName}`;
  }, [title]);
}
