import { useEffect, useState } from "react";
import { getProtocolRuntimeStatus } from "../../lib/api";
import { isTauriRuntime } from "../../lib/backend-runtime";
import { formatHostAddress } from "../../lib/utils";
import {
  emptyHostFormValues,
  formatHostProtocol,
  hostSupportsCredentialPrompt,
  hostSupportsJumpHosts,
  hostSupportsLiveTransport,
  hostSupportsSftp,
  hostSupportsTrustedKeys,
  hostToFormValues,
  protocolDefaultPort,
  protocolRequiresUsername,
  type HostRecord,
  type HostFormValues,
} from "../../types/host";
import { useConnectionSecretsStore } from "../../store/connection-secrets-store";
import { useHostsStore } from "../../store/hosts-store";
import { Modal } from "../common/Modal";

interface HostEditorProps {
  open: boolean;
  host?: HostRecord;
  onClose: () => void;
  onSave: (values: HostFormValues) => void;
}

const fieldClassName =
  "mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

export function HostEditor({ open, host, onClose, onSave }: HostEditorProps) {
  const hosts = useHostsStore((state) => state.hosts);
  const runtimeSecrets = useConnectionSecretsStore((state) =>
    host ? state.secretsByHostId[host.id] : undefined
  );
  const hydrateHostSecrets = useConnectionSecretsStore((state) => state.hydrateHostSecrets);
  const formId = host ? `host-editor-${host.id}` : "host-editor-new";
  const [values, setValues] = useState<HostFormValues>(() =>
    host
      ? {
          ...hostToFormValues(host),
          password: runtimeSecrets?.password ?? "",
          passphrase: runtimeSecrets?.passphrase ?? "",
        }
      : emptyHostFormValues
  );
  const nativeSecretStorage = isTauriRuntime();
  const [runtimeStatusMessage, setRuntimeStatusMessage] = useState<{
    available: boolean;
    installHint?: string;
    message: string;
  } | null>(null);
  const supportsCredentials = hostSupportsCredentialPrompt(values.protocol);
  const supportsJumpHosts = hostSupportsJumpHosts(values.protocol);
  const supportsTrustedKeys = hostSupportsTrustedKeys(values.protocol);
  const supportsSftp = hostSupportsSftp(values.protocol);
  const supportsNetworkFields = values.protocol !== "localShell";
  const requiresUsername = protocolRequiresUsername(values.protocol);
  const hostnameLabel = values.protocol === "serial" ? "Device path" : "Hostname";
  const hostnamePlaceholder =
    values.protocol === "serial" ? "/dev/cu.usbserial-1410" : "bastion.acme.internal";
  const portLabel =
    values.protocol === "serial" ? "Baud rate" : values.protocol === "telnet" ? "Port" : "Port";
  const portPlaceholder = String(protocolDefaultPort(values.protocol));
  const infoMessage =
    values.protocol === "localShell"
      ? "Local shell runs the current macOS login shell through the native bridge. No host trust, network credentials, jump host, or SFTP metadata is required for this entry."
      : values.protocol === "telnet"
        ? "Telnet sessions launch through the native bridge and keep only network location metadata in inventory."
        : values.protocol === "serial"
          ? "Serial sessions treat the device path as the host and the port field as the baud rate."
          : values.protocol === "mosh"
            ? "Mosh sessions launch through the native bridge and can reuse local SSH credentials when you store them here."
            : null;

  const isInvalid =
    !values.label.trim() ||
    (supportsNetworkFields && !values.hostname.trim()) ||
    (requiresUsername && !values.username.trim());
  const jumpHostOptions = hosts.filter(
    (candidate) => candidate.id !== host?.id && candidate.protocol === "ssh"
  );

  useEffect(() => {
    if (!open || !host) {
      return;
    }

    let cancelled = false;

    void hydrateHostSecrets(host.id).then((record) => {
      if (!record || cancelled) {
        return;
      }

      setValues((current) => ({
        ...current,
        passphrase: current.passphrase || record.passphrase,
        password: current.password || record.password,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [host, hydrateHostSecrets, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    void getProtocolRuntimeStatus(values.protocol)
      .then((status) => {
        if (cancelled) {
          return;
        }

        setRuntimeStatusMessage({
          available: status.available,
          installHint: status.installHint,
          message: status.message,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setRuntimeStatusMessage({
          available: false,
          message:
            error instanceof Error ? error.message : "Unable to determine protocol runtime availability.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, values.protocol]);

  return (
    <Modal
      open={open}
      title={host ? `Edit ${host.label}` : "Add Host"}
      description="Tune connection defaults, trust policy, and local-first metadata in one dense form."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={isInvalid}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {host ? "Save changes" : "Create host"}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();

          if (isInvalid) {
            return;
          }

          onSave(values);
        }}
      >
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="text-sm text-slate-300">Label</span>
          <input
            value={values.label}
            onChange={(event) => setValues((current) => ({ ...current, label: event.target.value }))}
            className={fieldClassName}
            placeholder="Production Gateway"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Protocol</span>
          <select
            value={values.protocol}
            onChange={(event) => {
              const protocol = event.target.value as HostFormValues["protocol"];
              setValues((current) => ({
                ...current,
                protocol,
                hostname: protocol === "localShell" ? "localhost" : current.hostname,
                username:
                  protocol === "localShell"
                    ? current.username || "local"
                    : protocolRequiresUsername(protocol)
                      ? current.username || "root"
                      : "",
                port: String(protocolDefaultPort(protocol)),
                authMethod: hostSupportsCredentialPrompt(protocol) ? current.authMethod : "none",
                privateKeyPath: hostSupportsCredentialPrompt(protocol) ? current.privateKeyPath : "",
                password: hostSupportsCredentialPrompt(protocol) ? current.password : "",
                passphrase: hostSupportsCredentialPrompt(protocol) ? current.passphrase : "",
                hostKeyPolicy: hostSupportsTrustedKeys(protocol) ? current.hostKeyPolicy : "allowUnknown",
                jumpHostId: hostSupportsJumpHosts(protocol) ? current.jumpHostId : "",
                agentForwarding: hostSupportsCredentialPrompt(protocol) ? current.agentForwarding : false,
                keyLabel: hostSupportsCredentialPrompt(protocol) ? current.keyLabel : "",
                sftpRoot: hostSupportsSftp(protocol) ? current.sftpRoot || "/home" : "",
              }));
            }}
            className={fieldClassName}
          >
            <option value="ssh">SSH</option>
            <option value="localShell">Local shell</option>
            <option value="mosh">Mosh</option>
            <option value="telnet">Telnet</option>
            <option value="serial">Serial</option>
          </select>
        </label>
        {supportsNetworkFields ? null : (
          <div className="md:col-span-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm leading-6 text-emerald-100">
            {infoMessage}
          </div>
        )}
        {supportsNetworkFields ? (
        <label className="block">
          <span className="text-sm text-slate-300">{hostnameLabel}</span>
          <input
            value={values.hostname}
            onChange={(event) => setValues((current) => ({ ...current, hostname: event.target.value }))}
            className={fieldClassName}
            placeholder={hostnamePlaceholder}
          />
        </label>
        ) : null}
        {supportsNetworkFields && requiresUsername ? (
        <label className="block">
          <span className="text-sm text-slate-300">Username</span>
          <input
            autoComplete="username"
            value={values.username}
            onChange={(event) => setValues((current) => ({ ...current, username: event.target.value }))}
            className={fieldClassName}
            placeholder="ops"
          />
        </label>
        ) : !supportsNetworkFields ? (
          <label className="block">
            <span className="text-sm text-slate-300">Shell label</span>
            <input
              autoComplete="username"
              value={values.username}
              onChange={(event) => setValues((current) => ({ ...current, username: event.target.value }))}
              className={fieldClassName}
            placeholder="local"
          />
        </label>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
            {formatHostProtocol(values.protocol)} sessions connect without a stored username.
          </div>
        )}
        {supportsNetworkFields ? (
        <label className="block">
          <span className="text-sm text-slate-300">{portLabel}</span>
          <input
            value={values.port}
            onChange={(event) => setValues((current) => ({ ...current, port: event.target.value }))}
            className={fieldClassName}
            placeholder={portPlaceholder}
          />
        </label>
        ) : null}
        {supportsCredentials ? (
        <label className="block">
          <span className="text-sm text-slate-300">Auth method</span>
          <select
            value={values.authMethod}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                authMethod: event.target.value as HostFormValues["authMethod"],
              }))
            }
            className={fieldClassName}
          >
            <option value="none">None / manual later</option>
            <option value="password">Password</option>
            <option value="privateKey">Private key path</option>
          </select>
        </label>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
            {formatHostProtocol(values.protocol)} entries do not store runtime credentials in host
            inventory.
          </div>
        )}
        {supportsCredentials ? (
        <label className="block">
          <span className="text-sm text-slate-300">Private key path</span>
          <input
            value={values.privateKeyPath}
            onChange={(event) =>
              setValues((current) => ({ ...current, privateKeyPath: event.target.value }))
            }
            className={fieldClassName}
            placeholder="~/.ssh/id_ed25519"
          />
        </label>
        ) : null}
        {supportsTrustedKeys ? (
        <label className="block">
          <span className="text-sm text-slate-300">Host key trust</span>
          <select
            value={values.hostKeyPolicy}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                hostKeyPolicy: event.target.value as HostFormValues["hostKeyPolicy"],
              }))
            }
            className={fieldClassName}
          >
            <option value="allowUnknown">Allow unknown key</option>
            <option value="requireTrusted">Require trusted key</option>
          </select>
        </label>
        ) : null}
        {supportsJumpHosts ? (
        <label className="block">
          <span className="text-sm text-slate-300">Jump host</span>
          <select
            value={values.jumpHostId}
            onChange={(event) =>
              setValues((current) => ({ ...current, jumpHostId: event.target.value }))
            }
            className={fieldClassName}
          >
            <option value="">Direct connection</option>
            {jumpHostOptions.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} · {formatHostAddress(candidate)}
              </option>
            ))}
          </select>
        </label>
        ) : null}
        {supportsCredentials ? (
        <label className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={values.agentForwarding}
            onChange={(event) =>
              setValues((current) => ({ ...current, agentForwarding: event.target.checked }))
            }
            className="h-4 w-4 accent-emerald-400"
          />
          Forward local SSH agent to this host
        </label>
        ) : null}
        {supportsCredentials ? (
        <label className="block">
          <span className="text-sm text-slate-300">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={(event) =>
              setValues((current) => ({ ...current, password: event.target.value }))
            }
            className={fieldClassName}
            placeholder={
              nativeSecretStorage
                ? "Stored in macOS Keychain in the native shell"
                : "Kept in memory only in the browser demo"
            }
          />
        </label>
        ) : null}
        {supportsCredentials ? (
        <label className="block">
          <span className="text-sm text-slate-300">Key passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={values.passphrase}
            onChange={(event) =>
              setValues((current) => ({ ...current, passphrase: event.target.value }))
            }
            className={fieldClassName}
            placeholder="Optional"
          />
        </label>
        ) : null}
        <label className="block">
          <span className="text-sm text-slate-300">Group</span>
          <input
            value={values.group}
            onChange={(event) => setValues((current) => ({ ...current, group: event.target.value }))}
            className={fieldClassName}
            placeholder="Acme / Production"
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Tags</span>
          <input
            value={values.tags}
            onChange={(event) => setValues((current) => ({ ...current, tags: event.target.value }))}
            className={fieldClassName}
            placeholder="prod, bastion, postgres"
          />
        </label>
        {supportsCredentials ? (
        <label className="block">
          <span className="text-sm text-slate-300">Identity label</span>
          <input
            value={values.keyLabel}
            onChange={(event) => setValues((current) => ({ ...current, keyLabel: event.target.value }))}
            className={fieldClassName}
            placeholder="MacBook Pro ED25519"
          />
        </label>
        ) : null}
        {supportsSftp ? (
        <label className="block">
          <span className="text-sm text-slate-300">SFTP root</span>
          <input
            value={values.sftpRoot}
            onChange={(event) => setValues((current) => ({ ...current, sftpRoot: event.target.value }))}
            className={fieldClassName}
            placeholder="/srv"
          />
        </label>
        ) : null}
        <label className="block">
          <span className="text-sm text-slate-300">Session environment</span>
          <textarea
            value={values.environment}
            onChange={(event) =>
              setValues((current) => ({ ...current, environment: event.target.value }))
            }
            className={`${fieldClassName} min-h-28 resize-y font-mono text-[12px] leading-5`}
            placeholder={"APP_ENV=production\nRAILS_LOG_TO_STDOUT=1"}
            spellCheck={false}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Notes</span>
          <textarea
            value={values.note}
            onChange={(event) => setValues((current) => ({ ...current, note: event.target.value }))}
            className={`${fieldClassName} min-h-28 resize-y`}
            placeholder="Operational context, bastion rules, or environment hints."
          />
        </label>
      </div>
      <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm leading-6 text-amber-100">
        {!supportsCredentials
          ? values.protocol === "localShell"
            ? "Protocol metadata stays in the local inventory, while the local shell runtime stays native-only and avoids stored host secrets altogether."
            : values.protocol === "telnet" || values.protocol === "serial"
              ? `${formatHostProtocol(values.protocol)} sessions stay native and do not persist transport credentials in inventory.`
              : `${formatHostProtocol(values.protocol)} sessions can reuse local SSH defaults even when no runtime secret is stored in inventory.`
          : nativeSecretStorage
          ? "Passwords and passphrases stay outside the host inventory and persist through macOS Keychain in the native shell."
          : "Passwords and passphrases stay in memory only in the browser demo and are not exported with host metadata."}
      </div>
      {runtimeStatusMessage ? (
      <div
        className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${
          runtimeStatusMessage.available
            ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-100"
            : "border-rose-400/30 bg-rose-400/10 text-rose-100"
        }`}
      >
        {runtimeStatusMessage.message}
        {runtimeStatusMessage.installHint ? (
          <p className="mt-2 text-xs text-rose-100/80">{runtimeStatusMessage.installHint}</p>
        ) : null}
      </div>
      ) : null}
      {supportsTrustedKeys ? (
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-300">
        Require trusted key blocks SSH, SFTP, and snippet execution until the host key is scanned
        and trusted in the Keys workspace.
      </div>
      ) : null}
      {supportsJumpHosts ? (
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-300">
        Jump hosts are one-hop only for now. If the selected bastion needs a password or key
        passphrase, the runtime prompt will ask for its secrets before connecting onward.
      </div>
      ) : null}
      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-6 text-slate-300">
        Session environment uses one <span className="font-mono text-[12px]">KEY=VALUE</span> pair
        per line. Agent forwarding reuses the current <span className="font-mono text-[12px]">$SSH_AUTH_SOCK</span> only
        when it exists locally. {hostSupportsLiveTransport(values.protocol)
          ? `${formatHostProtocol(values.protocol)} sessions can be opened natively from this inventory entry.`
          : "This protocol is inventory-only in the current build."}
      </div>
      <label className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={values.favorite}
          onChange={(event) => setValues((current) => ({ ...current, favorite: event.target.checked }))}
          className="h-4 w-4 accent-emerald-400"
        />
        Pin this host to Favorites
      </label>
      </form>
    </Modal>
  );
}
