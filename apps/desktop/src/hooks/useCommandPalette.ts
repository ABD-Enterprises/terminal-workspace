import { useEffect } from "react";
import { isPrimaryShortcut } from "../lib/shortcuts";
import { useAppStore } from "../store/app-store";

export function useCommandPalette() {
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPrimaryShortcut(event, "k")) {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (event.key === "Escape") {
        closeCommandPalette();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeCommandPalette, openCommandPalette]);
}
