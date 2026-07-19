import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ErrorBoundary, installGlobalRejectionHandler } from "./components/ErrorBoundary";
import { ensureIdentitiesMigrated } from "./store/identities-store";
import "./styles/globals.css";

const queryClient = new QueryClient();

// Surface otherwise-lost promise rejections (e.g. fire-and-forget IPC calls)
// instead of letting them vanish silently.
installGlobalRejectionHandler();

// Run the host→identity auto-migration once per session as soon as the
// stores have hydrated. Idempotent and self-healing — see
// docs/parity-and-hardening-plan.md P2-DM1 (batch 1). Failures are logged
// inside `ensureIdentitiesMigrated` and do not block app startup.
ensureIdentitiesMigrated();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </QueryClientProvider>
);
