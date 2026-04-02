import { useState } from "react";
import { isTauriRuntime } from "../../lib/backend-runtime";
import type { ConnectionSecretPromptRequest } from "../../store/connection-secret-prompt-store";
import { useConnectionSecretPromptStore } from "../../store/connection-secret-prompt-store";
import { getHostConnectionSecrets, useConnectionSecretsStore } from "../../store/connection-secrets-store";
import { Modal } from "./Modal";

const fieldClassName =
  "mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

function ConnectionSecretPromptForm({ pendingRequest }: { pendingRequest: ConnectionSecretPromptRequest }) {
  const clearPrompt = useConnectionSecretPromptStore((state) => state.clearPrompt);
  const setHostSecrets = useConnectionSecretsStore((state) => state.setHostSecrets);
  const existingSecrets = getHostConnectionSecrets(pendingRequest.hostId);
  const formId = `connection-secret-prompt-${pendingRequest.hostId}`;
  const [password, setPassword] = useState(existingSecrets.password);
  const [passphrase, setPassphrase] = useState(existingSecrets.passphrase);
  const nativeSecretStorage = isTauriRuntime();

  const isInvalid =
    (pendingRequest.needsPassword && !password) ||
    (pendingRequest.needsPassphrase && !passphrase);

  return (
    <form
      id={formId}
      onSubmit={async (event) => {
        event.preventDefault();

        if (isInvalid) {
          return;
        }

        await Promise.resolve(
          setHostSecrets(pendingRequest.hostId, {
            password,
            passphrase,
          })
        );
        clearPrompt(true);
      }}
    >
      <div className="space-y-4">
        {pendingRequest.needsPassword ? (
          <label className="block">
            <span className="text-sm text-slate-300">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={fieldClassName}
              placeholder="Required for this connection"
            />
          </label>
        ) : null}

        {pendingRequest.needsPassphrase ? (
          <label className="block">
            <span className="text-sm text-slate-300">Key passphrase</span>
            <input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className={fieldClassName}
              placeholder="Required to unlock the private key"
            />
          </label>
        ) : null}

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-300">
          {nativeSecretStorage
            ? "In the native shell, runtime secrets are stored in macOS Keychain and kept out of host exports."
            : "In the browser demo, runtime secrets stay in memory only for the current app session."}
        </div>
      </div>
      <div className="mt-6 border-t border-slate-800 pt-5">
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => clearPrompt(false)}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={Boolean(isInvalid)}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Continue
          </button>
        </div>
      </div>
    </form>
  );
}

export function ConnectionSecretPrompt() {
  const pendingRequest = useConnectionSecretPromptStore((state) => state.pendingRequest);
  const clearPrompt = useConnectionSecretPromptStore((state) => state.clearPrompt);
  const nativeSecretStorage = isTauriRuntime();

  return (
    <Modal
      open={Boolean(pendingRequest)}
      title={pendingRequest ? `${pendingRequest.actionLabel}: ${pendingRequest.hostLabel}` : "Runtime secret"}
      description={
        pendingRequest
          ? nativeSecretStorage
            ? `Enter the missing runtime credentials for ${pendingRequest.username}@${pendingRequest.hostname}. These secrets stay outside the host inventory and are stored in macOS Keychain.`
            : `Enter the missing runtime credentials for ${pendingRequest.username}@${pendingRequest.hostname}. These secrets stay in memory only for this browser session.`
          : undefined
      }
      onClose={() => clearPrompt(false)}
      className="max-w-xl"
    >
      {pendingRequest ? (
        <ConnectionSecretPromptForm
          key={`${pendingRequest.hostId}:${pendingRequest.needsPassword}:${pendingRequest.needsPassphrase}`}
          pendingRequest={pendingRequest}
        />
      ) : null}
    </Modal>
  );
}
