export function isMacClient() {
  if (typeof navigator === "undefined") {
    return true;
  }

  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function isPrimaryShortcut(event: KeyboardEvent, key: string) {
  const usesMeta = isMacClient();
  const primaryKeyPressed = usesMeta ? event.metaKey : event.ctrlKey;

  return primaryKeyPressed && event.key.toLowerCase() === key.toLowerCase();
}

export function formatPrimaryShortcut(key: string) {
  return isMacClient() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
}
