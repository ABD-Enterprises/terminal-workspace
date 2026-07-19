// Top-level render error boundary + global unhandled-rejection surfacing.
//
// Before this, main.tsx rendered <App/> bare: any render-phase exception
// (e.g. a corrupt persisted pane shape that survives normalization) would
// white-screen the whole window with no recovery, and fire-and-forget IPC
// promises rejected silently. This module provides a boundary that renders a
// recovery UI instead of a blank tree, and a handler that logs otherwise-lost
// rejections. There is no app-wide logging path yet (see #145), so both
// surface to console.error to stay observable.

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort recovery UI. Kept as a plain, side-effect-free presentational
 * component (styled with the shell CSS variables via inline styles so it
 * renders even when higher-level theming is the thing that broke) and
 * exported so it can be rendered/asserted directly in tests.
 */
export function ErrorFallback({ error, onReload }: { error: Error; onReload: () => void }): ReactNode {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        background: "var(--shell-base, #07111b)",
        color: "var(--shell-text, #ebf2ff)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "32rem",
          width: "100%",
          border: "1px solid var(--shell-border, #1f2c42)",
          background: "var(--shell-panel, #0d1724)",
          borderRadius: "1rem",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "var(--shell-muted, #8ea0bd)" }}>
          {error.message || "The app hit an unexpected error."}
        </p>
        <button
          type="button"
          autoFocus
          onClick={onReload}
          style={{
            marginTop: "1.25rem",
            borderRadius: "0.75rem",
            background: "var(--shell-accent, #76e4c3)",
            color: "var(--shell-base, #07111b)",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render error caught by ErrorBoundary:", error, info.componentStack);
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReload={this.handleReload} />;
    }
    return this.props.children;
  }
}

/**
 * Surface an otherwise-lost promise rejection. Pure and exported so tests can
 * exercise it without a DOM.
 */
export function logUnhandledRejection(reason: unknown): void {
  console.error("Unhandled promise rejection:", reason);
}

let rejectionHandlerInstalled = false;

/** Register the global `unhandledrejection` handler exactly once. */
export function installGlobalRejectionHandler(): void {
  if (rejectionHandlerInstalled || typeof window === "undefined") {
    return;
  }
  rejectionHandlerInstalled = true;
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    logUnhandledRejection(event.reason);
  });
}
