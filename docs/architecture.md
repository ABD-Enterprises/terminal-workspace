# Architecture

Tauri shell plus a React + TypeScript + Tailwind workspace.

Today the browser and demo experience are the most mature paths:

- the React app owns routing, workspace state, and demo-mode behavior
- the Node backend still handles the browser path plus SFTP, snippets, and forwarding
- the Tauri shell now proxies backend discovery, JSON/binary API access, direct SSH and jump-host session lifecycle, native session stream I/O, and Keychain-backed runtime secret persistence

The intended end state is still Rust-backed local transport and persistence, but the current codebase
is intentionally using a staged seam so the web/demo surface stays stable while native ownership
expands.
