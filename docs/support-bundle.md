# Support Bundle

When reporting a packaged app issue, include the most recent Terminal Workspace log file and describe what you were doing when the issue happened. Do not include private keys, passwords, recovery codes, or SSH configuration files in a support bundle.

The app writes rotating logs through the Tauri log plugin. Look for `terminal-workspace.log` in the platform log directory:

- macOS: `~/Library/Logs/com.abdenterprises.terminalworkspace/`
- Windows: `%LOCALAPPDATA%\com.abdenterprises.terminalworkspace\logs\`
- Linux: `$XDG_DATA_HOME/com.abdenterprises.terminalworkspace/logs/` or `~/.local/share/com.abdenterprises.terminalworkspace/logs/`

If there are rotated files next to the current log, include the newest rotated file as well.
