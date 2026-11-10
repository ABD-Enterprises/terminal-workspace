// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { useFingerprintTrustPromptStore } from "../../store/fingerprint-trust-prompt-store";
import { FingerprintTrustPrompt } from "./FingerprintTrustPrompt";

describe("FingerprintTrustPrompt (#510)", () => {
  afterEach(() => {
    act(() => useFingerprintTrustPromptStore.getState().clearPrompt(null));
    cleanup();
  });

  it("announces that a host key decision is needed when it opens", () => {
    render(
      <MemoryRouter>
        <FingerprintTrustPrompt />
      </MemoryRouter>
    );
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => {
      void useFingerprintTrustPromptStore.getState().openPrompt({
        hostId: "h1",
        hostLabel: "Prod",
        hostname: "prod.example.com",
        port: 22,
        candidates: [],
      });
    });

    expect(screen.getByRole("alert").textContent).toBe("Host key approval needed for Prod.");
  });
});
