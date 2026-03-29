import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { HostsPage } from "./HostsPage";
import { KeysPage } from "./KeysPage";
import { SessionsPage } from "./SessionsPage";
import { SettingsPage } from "./SettingsPage";
import { SnippetsPage } from "./SnippetsPage";
import { TransfersPage } from "./TransfersPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route index element={<Navigate to="/hosts" replace />} />
          <Route path="/hosts" element={<HostsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/snippets" element={<SnippetsPage />} />
          <Route path="/keys" element={<KeysPage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
