---
name: win-tamash
description: 'Windows Health MCP server development skill. Use when: adding new tools to win-tamash; editing existing tools; wiring tools into the MCP server; updating tests; working with the safety allowlist; debugging PowerShell scripts in tool files; understanding the project architecture. DO NOT USE FOR: general TypeScript questions; unrelated MCP servers.'
argument-hint: 'Describe what you want to add or fix in win-tamash'
---

# win-tamash — Windows Health MCP Server

## Project Overview

`win-tamash` is a Windows-only MCP (Model Context Protocol) server for Claude Desktop. It gives Claude 17 tools to diagnose, analyse, and fix Windows performance problems using natural language.

- **Location**: `d:\QtpSudhakarOrg\tamash-windows`
- **Global command**: `win-tamash` (registered via `npm link`)
- **GitHub**: `https://github.com/vibetestq-tamash/tamash-windows`
- **Entry point**: `src/index.ts`

---

## Architecture

```
src/
├── index.ts              ← McpServer + StdioServerTransport; registers all tools with Zod schemas
└── tools/
    ├── get_system_health.ts
    ├── get_top_processes.ts
    ├── analyze_slowdown.ts
    ├── get_network_health.ts
    ├── get_startup_items.ts
    ├── suggest_restarts.ts
    ├── get_battery_health.ts
    ├── get_windows_update_status.ts
    ├── get_event_log_errors.ts
    ├── clean_temp_files.ts
    ├── optimize_for_meeting.ts
    ├── restore_after_meeting.ts
    ├── kill_process.ts
    ├── disable_startup_item.ts
    ├── set_display_scaling.ts
    └── schedule_maintenance.ts

safety/
└── allowlist.json        ← safeToKillProcesses, forbiddenProcesses, safePaths, forbiddenPaths

test.ts                   ← Smoke tests for all 17 tools (run with: npx tsx test.ts)
```

---

## Tool Inventory

### Read Tools (safe, no side effects)
| Tool | Key data source |
|------|----------------|
| `get_system_health` | Performance counter CPU, `os` module RAM, WMI disk |
| `get_top_processes` | `Get-Process` → client-side group-by-name |
| `analyze_slowdown` | RAM, page file, startup count, disk, uptime |
| `get_network_health` | `Test-Connection` ping, `Get-NetTCPConnection`, `Get-NetAdapter` |
| `get_startup_items` | `Get-CimInstance Win32_StartupCommand` |
| `suggest_restarts` | Groups processes vs `FRESH_MEMORY_MB` baseline map |
| `get_battery_health` | `Win32_Battery`, `BatteryStaticData`, `BatteryFullChargedCapacity` WMI classes |
| `get_windows_update_status` | `Microsoft.Update.Session` COM object (no extra modules needed) |
| `get_event_log_errors` | `Get-WinEvent -FilterHashtable` System+Application logs |

### Action Tools (mutate system state)
| Tool | Default | Safety |
|------|---------|--------|
| `clean_temp_files` | dry_run=true | Allowlist paths; age threshold; open-handle check |
| `optimize_for_meeting` | dry_run=false | Allowlist kill targets; reversible |
| `restore_after_meeting` | — | Restore-only; no kills |
| `kill_process` | — | Allowlist + forbidden list; hard-blocks OS processes |
| `disable_startup_item` | dry_run=true | Provides undo hint; registry + startup folder |
| `set_display_scaling` | dry_run=true | Registry write; warns logout required |
| `schedule_maintenance` | dry_run=true | Task Scheduler; daily %TEMP% clean + Recycle Bin |

---

## Adding a New Tool — Procedure

### 1. Create `src/tools/<tool_name>.ts`

```typescript
import { execSync } from 'child_process';

export interface MyToolResult {
  // typed fields only — no `any` in results
  summary: string;
}

export async function myTool(param: string): Promise<MyToolResult> {
  const raw = execSync(
    `powershell -NoProfile -Command "..."`,
    { timeout: 15000, windowsHide: true }
  ).toString().trim();

  const data = JSON.parse(raw);
  return { summary: '...' };
}
```

**Critical patterns:**
- Always pass `windowsHide: true` to `execSync` — prevents terminal flicker
- Always set an explicit `timeout` (ms) — PowerShell can hang
- Use `-NoProfile` and `-Compress` (for ConvertTo-Json) in every PowerShell call
- Wrap PowerShell multi-line scripts: `.trim().replace(/\n\s*/g, ' ')` before passing to shell
- Never use double-quoted strings *inside* the outer double-quoted PowerShell argument — use single quotes inside: `$searcher.Search('IsInstalled=0')`
- Always handle the `catch` case and return a graceful result (never throw from a tool)

### 2. Register in `src/index.ts`

Add the import at the top (with existing imports):
```typescript
import { myTool } from './tools/my_tool.js';   // note .js extension
```

Add the registration before the `// ─── Start server` comment:
```typescript
server.tool(
  'my_tool',
  'One sentence description of what it does and when to use it.',
  {
    param: z.string().describe('What this param controls'),
    dry_run: z.boolean().optional().default(true).describe('...'),
  },
  async ({ param, dry_run }) => {
    const result = await myTool(param, dry_run);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);
```

### 3. Add a test block to `test.ts`

```typescript
import { myTool } from './src/tools/my_tool';   // no .js in test imports

// In the run() function:
console.log(`\n${SEP}`);
console.log('TOOL N: my_tool');
console.log(SEP);
try {
  const r = await myTool('safe_test_value');
  console.log(`Summary: ${r.summary}`);
} catch (e) { console.error('FAILED:', e); }
```

### 4. Build, test, push

```bash
npx tsc --noEmit          # type-check (must be clean)
npx tsx test.ts           # run all smoke tests
npx tsc                   # build to dist/
npm link                  # re-register global command
git add -A
git commit -m "feat: add my_tool"
git push
```

---

## Safety Allowlist

`safety/allowlist.json` controls all action tools:

```json
{
  "safeToKillProcesses": ["SearchIndexer.exe", "OneDrive.exe", "Teams.exe", ...],
  "forbiddenProcesses": ["explorer", "lsass", "svchost", "csrss", "winlogon", ...],
  "safePaths": {
    "tempDirectories": ["%TEMP%", "C:\\Windows\\Temp", ...],
    "browserCaches": ["%LOCALAPPDATA%\\Google\\Chrome\\...", ...]
  },
  "forbiddenPaths": ["C:\\Windows\\System32", "C:\\Program Files", ...]
}
```

**Rules:**
- `kill_process`: checks `forbiddenProcesses` first (hard-block), then requires entry in `safeToKillProcesses`
- `clean_temp_files`: only touches paths in `safePaths.tempDirectories` + `safePaths.browserCaches`
- `optimize_for_meeting`: kills only processes in `safeToKillProcesses`
- To permit a new process/path, add it to the allowlist — never bypass the check in code

---

## Known Issues & Gotchas

| Problem | Root Cause | Fix |
|---------|-----------|-----|
| PowerShell variable not found | Multi-statement script with `$var` fails under execSync double-quote wrapping | Inline the pipeline as a single expression; avoid variables |
| CPU % always 0 from WMI | `Win32_Processor.LoadPercentage` is a snapshot, unreliable | Use `Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 2` |
| `spawn ENOENT` in restore_after_meeting | `spawn().unref()` without error handler kills the process | Add `child.on('error', () => {})` before `.unref()` |
| WU search string parse error | Inner double quotes in `$searcher.Search("...")` stripped by shell | Use single quotes: `$searcher.Search('IsInstalled=0')` |
| Registry error printed to stderr | `-ErrorAction Stop` on `Get-ItemProperty` logs to stderr even when caught | Use `-ErrorAction SilentlyContinue` for optional registry reads |
| `tsconfig` deprecation warning | Old `moduleResolution` without `ignoreDeprecations` | `tsconfig.json` has `"ignoreDeprecations": "6.0"` and `"types": ["node"]` |

---

## Development Commands

```bash
npm run dev          # tsx watch mode — no build step needed
npx tsc --noEmit     # type-check only
npx tsx test.ts      # run all 17 smoke tests
npx tsc              # build to dist/
npm link             # register win-tamash globally
```

---

## Claude Desktop Config

```json
{
  "mcpServers": {
    "win-tamash": {
      "command": "win-tamash"
    }
  }
}
```

Config file location: `%APPDATA%\Claude\claude_desktop_config.json`
