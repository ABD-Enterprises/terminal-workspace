# User Guide

## Runtime Modes

- Demo mode keeps sessions, transfers, snippets, keys, and trust scans inside deterministic mock
  flows.
- Native mode uses the Tauri bridge for real SSH sessions, SFTP, forwarding, snippets, key
  inspection, key generation, and known-host scans.

## Key And Trust Workflow

1. Open `Keys`
2. Import an existing private key or generate a new one locally
3. Scan a host key before enabling strict trust on a host
4. Trust the scanned host key
5. Assign the key to a host if you want it available as the default identity

## Export Behavior

- Hosts, keys, snippets, and trusted host keys are exportable
- Runtime passwords and passphrases are not exportable
