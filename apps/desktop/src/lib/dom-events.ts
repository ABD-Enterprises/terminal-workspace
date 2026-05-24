export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  return target.isContentEditable;
}

export function hasCommandModifier(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey">) {
  return event.metaKey || event.ctrlKey || event.altKey;
}
