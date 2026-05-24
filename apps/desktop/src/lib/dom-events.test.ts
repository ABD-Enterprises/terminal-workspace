import { afterEach, describe, expect, it, vi } from "vitest";
import { hasCommandModifier, isTypingTarget } from "./dom-events";

class FakeHTMLElement {
  constructor(
    readonly tagName: string,
    readonly isContentEditable = false,
  ) {}
}

describe("dom event helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects editable typing targets", () => {
    vi.stubGlobal("HTMLElement", FakeHTMLElement);
    const input = new FakeHTMLElement("INPUT");
    const select = new FakeHTMLElement("SELECT");
    const editable = new FakeHTMLElement("DIV", true);

    expect(isTypingTarget(input as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(select as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(editable as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeHTMLElement("BUTTON") as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("detects command modifiers without shift", () => {
    expect(hasCommandModifier({ altKey: false, ctrlKey: false, metaKey: false })).toBe(false);
    expect(hasCommandModifier({ altKey: true, ctrlKey: false, metaKey: false })).toBe(true);
    expect(hasCommandModifier({ altKey: false, ctrlKey: true, metaKey: false })).toBe(true);
    expect(hasCommandModifier({ altKey: false, ctrlKey: false, metaKey: true })).toBe(true);
  });
});
