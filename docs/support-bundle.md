# Support Bundle

Packaged desktop builds write diagnostics to Tauri's recommended application log directory. When reporting a field issue, include the current log file from the path for your platform:

- macOS: `~/Library/Logs/com.abdenterprises.terminalworkspace/`
- Linux: `~/.local/share/com.abdenterprises.terminalworkspace/logs/`
- Windows: `%LOCALAPPDATA%\com.abdenterprises.terminalworkspace\logs\`

The log sink is for lifecycle and error diagnostics only. Do not paste private keys, passwords, release signing material, or host credentials into support requests.
