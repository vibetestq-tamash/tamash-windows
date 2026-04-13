# win-tamash

A Windows system health MCP (Model Context Protocol) server for [Claude Desktop](https://claude.ai/download). Gives Claude the ability to diagnose, analyse, and fix Windows performance problems using natural language.

---

## What it does

Instead of opening Task Manager and guessing what's wrong, you just tell Claude:

> *"My PC is slow, what's going on?"*
> *"I have a meeting in 5 minutes, get my PC ready"*
> *"How much RAM would I save by restarting Chrome?"*

Claude calls the right tools, correlates the findings, and gives you a ranked action plan — or just fixes it.

---

## Tools

| Tool | Type | What it does |
|---|---|---|
| `get_system_health` | Read | CPU %, RAM usage, disk space, uptime — overall status |
| `get_top_processes` | Read | Top N processes by CPU or memory, grouped by name |
| `analyze_slowdown` | Read | Diagnoses *why* the PC is slow — memory pressure, page file, startup bloat, low disk |
| `get_network_health` | Read | Ping latency to 8.8.8.8 / 1.1.1.1, active TCP connections, adapter status |
| `get_startup_items` | Read | Lists all startup programs, flags known heavy apps |
| `suggest_restarts` | Read | Detects memory bloat per app vs clean-start baseline — tells you exactly how many MB you'd recover |
| `clean_temp_files` | **Action** | Deletes old temp files and browser caches (dry run by default) |
| `optimize_for_meeting` | **Action** | Closes distracting apps, pauses background updaters, switches to High Performance power plan |
| `restore_after_meeting` | **Action** | Undoes `optimize_for_meeting` — back to Balanced plan, restarts OneDrive/Search |

---

## Safety

Every action tool has multiple safety layers:

- **`dry_run: true` by default** on `clean_temp_files` — shows what *would* be deleted before doing anything
- **Allowlist** (`safety/allowlist.json`) — only paths and processes explicitly listed can be touched
- **Forbidden list** — `System32`, `Program Files`, `lsass`, `svchost`, `explorer` etc. are hard-blocked regardless of any input
- **Age threshold** — `clean_temp_files` only touches files older than `max_age_days` (default 7)
- **Open handle check** — files currently in use by another process are skipped, never force-deleted

---

## Installation

### 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude Desktop](https://claude.ai/download)

### 2. Clone and install

```bash
git clone https://github.com/vibetestq-tamash/tamash-windows.git
cd tamash-windows
npm install
```

### 3. Build

```bash
npm run build
```

### 4. Register as a global command

```bash
npm link
```

This makes `win-tamash` available system-wide without specifying a path.

### 5. Connect to Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "win-tamash": {
      "command": "win-tamash"
    }
  }
}
```

Restart Claude Desktop. The tools will appear automatically.

---

## Example conversations

**Slow PC diagnosis:**
> You: "My PC feels sluggish"
> Claude calls `analyze_slowdown` → `get_startup_items` → `suggest_restarts`
> Claude: *"You have 16 startup programs including Docker and Teams. Chrome has been running 8h with 29 processes and is using 3.5 GB — restarting it would free ~3.2 GB. Want me to do that?"*

**Pre-meeting prep:**
> You: "I have a standup in 5 minutes"
> Claude calls `get_network_health` → `optimize_for_meeting`
> Claude: *"Network looks good (15ms). I've paused Windows Search and OneDrive, and switched to High Performance power plan."*

**Post-meeting cleanup:**
> You: "Meeting's done"
> Claude calls `restore_after_meeting`
> Claude: *"Restored Balanced power plan and restarted OneDrive sync."*

---

## Development

```bash
# Run in dev mode (no build step needed)
npm run dev

# Type-check
npx tsc --noEmit

# Run all tool tests
npx tsx test.ts

# Watch mode
npm run watch
```

---

## Project structure

```
tamash-windows/
├── src/
│   ├── index.ts                     ← MCP server entry point
│   └── tools/
│       ├── get_system_health.ts
│       ├── get_top_processes.ts
│       ├── analyze_slowdown.ts
│       ├── get_network_health.ts
│       ├── get_startup_items.ts
│       ├── suggest_restarts.ts
│       ├── clean_temp_files.ts
│       ├── optimize_for_meeting.ts
│       └── restore_after_meeting.ts
├── safety/
│   └── allowlist.json               ← Safe paths and processes
├── test.ts                          ← Tool smoke tests
├── tsconfig.json
└── package.json
```

---

## Customising the allowlist

Edit `safety/allowlist.json` to control what the action tools can touch:

```json
{
  "safeToKillProcesses": ["Spotify.exe", "Discord.exe", ...],
  "safePaths": {
    "tempDirectories": ["%TEMP%", "C:\\Windows\\Temp", ...],
    "browserCaches": ["%LOCALAPPDATA%\\Google\\Chrome\\...", ...]
  },
  "forbiddenPaths": ["C:\\Windows\\System32", ...],
  "forbiddenProcesses": ["lsass.exe", "explorer.exe", ...]
}
```

---

## License

ISC
