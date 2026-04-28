import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ConnectionSecretPrompt } from "../components/common/ConnectionSecretPrompt";
import { FingerprintTrustPrompt } from "../components/common/FingerprintTrustPrompt";
import { AppShell } from "../components/layout/AppShell";

const HostsPage = lazy(() => import("./HostsPage").then((module) => ({ default: module.HostsPage })));
const KeysPage = lazy(() => import("./KeysPage").then((module) => ({ default: module.KeysPage })));
const SessionsPage = lazy(() =>
  import("./SessionsPage").then((module) => ({ default: module.SessionsPage }))
);
const SettingsPage = lazy(() =>
  import("./SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const SnippetsPage = lazy(() =>
  import("./SnippetsPage").then((module) => ({ default: module.SnippetsPage }))
);
const TransfersPage = lazy(() =>
  import("./TransfersPage").then((module) => ({ default: module.TransfersPage }))
);

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center rounded-[18px] border border-slate-800/80 bg-slate-950/35">
      <div className="flex items-center gap-3 rounded-full border border-slate-800 bg-slate-950/80 px-4 py-2 text-sm text-slate-300">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-300" />
        Loading workspace view
      </div>
    </div>
  );
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/hosts" replace />} />
            <Route
              path="/hosts"
              element={
                <LazyRoute>
                  <HostsPage />
                </LazyRoute>
              }
            />
            <Route
              path="/sessions"
              element={
                <LazyRoute>
                  <SessionsPage />
                </LazyRoute>
              }
            />
            <Route
              path="/snippets"
              element={
                <LazyRoute>
                  <SnippetsPage />
                </LazyRoute>
              }
            />
            <Route
              path="/keys"
              element={
                <LazyRoute>
                  <KeysPage />
                </LazyRoute>
              }
            />
            <Route
              path="/transfers"
              element={
                <LazyRoute>
                  <TransfersPage />
                </LazyRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <LazyRoute>
                  <SettingsPage />
                </LazyRoute>
              }
            />
          </Route>
        </Routes>
        <ConnectionSecretPrompt />
        <FingerprintTrustPrompt />
      </>
    </BrowserRouter>
  );
}
