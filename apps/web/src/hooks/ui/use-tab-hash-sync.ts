import { useEffect } from "react";

export const useTabHashSync = (
  tab: string,
  setTab: (value: string) => void,
) => {
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      setTab(hash);
    }

    const onHashChange = () => {
      const nextHash = window.location.hash.replace(/^#/, "");
      if (nextHash) {
        setTab(nextHash);
      }
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [setTab]);

  useEffect(() => {
    if (!tab) return;
    const nextHash = `#${tab}`;
    if (window.location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }, [tab]);
};
