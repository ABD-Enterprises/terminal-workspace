// Reads `appShellTheme` from app-store and toggles `data-app-theme`
// on document.documentElement so CSS variables in index.css can
// switch. T20.
//
// In "system" mode we also subscribe to prefers-color-scheme so the
// shell updates in real time when the OS toggles dark mode.

import { useEffect } from "react";
import { useAppStore } from "../store/app-store";

function resolveTheme(theme: "system" | "light" | "dark"): "light" | "dark" {
  if (theme === "system") {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return "dark";
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

export function useAppShellTheme() {
  const appShellTheme = useAppStore((state) => state.appShellTheme);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(appShellTheme);
      document.documentElement.dataset.appTheme = resolved;
    };
    apply();

    if (appShellTheme !== "system") {
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => apply();
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [appShellTheme]);
}
