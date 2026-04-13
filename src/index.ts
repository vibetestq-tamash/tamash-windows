#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getSystemHealth } from './tools/get_system_health.js';
import { getTopProcesses } from './tools/get_top_processes.js';
import { analyzeSlowdown } from './tools/analyze_slowdown.js';
import { cleanTempFiles } from './tools/clean_temp_files.js';
import { optimizeForMeeting } from './tools/optimize_for_meeting.js';
import { restoreAfterMeeting } from './tools/restore_after_meeting.js';
import { getNetworkHealth } from './tools/get_network_health.js';
import { getStartupItems } from './tools/get_startup_items.js';
import { suggestRestarts } from './tools/suggest_restarts.js';
import { killProcess } from './tools/kill_process.js';
import { disableStartupItem } from './tools/disable_startup_item.js';
import { getBatteryHealth } from './tools/get_battery_health.js';
import { getWindowsUpdateStatus } from './tools/get_windows_update_status.js';
import { getEventLogErrors } from './tools/get_event_log_errors.js';
import { setDisplayScaling } from './tools/set_display_scaling.js';
import { scheduleMaintenance } from './tools/schedule_maintenance.js';

const server = new McpServer({
  name: 'win-tamash',
  version: '1.0.0',
});

// ─── Tool: get_system_health ─────────────────────────────────────────────────
server.tool(
  'get_system_health',
  'Get a real-time snapshot of CPU, RAM, and disk health. Returns an overall status (healthy/warning/critical) with a plain-English summary.',
  {},
  async () => {
    const result = await getSystemHealth();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_top_processes ─────────────────────────────────────────────────
server.tool(
  'get_top_processes',
  'List the top N processes sorted by CPU or memory usage. Useful for identifying resource hogs.',
  {
    sort_by: z
      .enum(['cpu', 'memory'])
      .optional()
      .default('cpu')
      .describe('Sort processes by cpu or memory usage'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Number of top processes to return (1–50)'),
  },
  async ({ sort_by, limit }) => {
    const result = await getTopProcesses(sort_by, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: analyze_slowdown ──────────────────────────────────────────────────
server.tool(
  'analyze_slowdown',
  'Diagnose WHY your PC is slow. Detects memory pressure, page file usage, startup bloat, and low disk space. Returns severity-ranked findings and quick-win recommendations.',
  {},
  async () => {
    const result = await analyzeSlowdown();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: clean_temp_files ──────────────────────────────────────────────────
server.tool(
  'clean_temp_files',
  'Delete temporary files from Windows temp directories. Always runs as dry_run=true by default — set dry_run=false to actually delete. Only touches paths in the safety allowlist.',
  {
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true (default), only reports what would be deleted without deleting anything'),
    max_age_days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .default(7)
      .describe('Only delete files older than this many days (default: 7)'),
  },
  async ({ dry_run, max_age_days }) => {
    const result = await cleanTempFiles(dry_run, max_age_days);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: optimize_for_meeting ──────────────────────────────────────────────
server.tool(
  'optimize_for_meeting',
  'Prepare your PC for a video call or presentation. Closes distracting apps, pauses background updaters, and switches to High Performance power plan. Runs dry_run=false by default since this is intentional and reversible.',
  {
    dry_run: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, only reports what would be done without making changes'),
    minutes_until_meeting: z
      .number()
      .int()
      .min(0)
      .max(120)
      .optional()
      .default(5)
      .describe('How many minutes until the meeting starts (used for summary messaging)'),
  },
  async ({ dry_run, minutes_until_meeting }) => {
    const result = await optimizeForMeeting(dry_run, minutes_until_meeting);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: restore_after_meeting ────────────────────────────────────────────
server.tool(
  'restore_after_meeting',
  'Undo the changes made by optimize_for_meeting: switches back to Balanced power plan and restarts background services (OneDrive, Search Indexer) that were paused.',
  {},
  async () => {
    const result = await restoreAfterMeeting();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_network_health ────────────────────────────────────────────────
server.tool(
  'get_network_health',
  'Check internet connectivity and latency by pinging 8.8.8.8 and 1.1.1.1. Reports active TCP connections and network adapter status. Useful before video calls.',
  {},
  async () => {
    const result = await getNetworkHealth();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_startup_items ─────────────────────────────────────────────────
server.tool(
  'get_startup_items',
  'List all programs that launch at Windows startup. Flags known heavy/slow apps. Use this to identify startup bloat detected by analyze_slowdown.',
  {},
  async () => {
    const result = await getStartupItems();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: suggest_restarts ─────────────────────────────────────────────────
server.tool(
  'suggest_restarts',
  'Checks how long each app has been running and how much memory it has accumulated vs a clean-start baseline. Tells you exactly how many MB you would recover by restarting Chrome, VS Code, Slack, etc. — and asks whether to do it.',
  {},
  async () => {
    const result = await suggestRestarts();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: kill_process ──────────────────────────────────────────────────────
server.tool(
  'kill_process',
  'Kill all running instances of a named process. Only processes on the safety allowlist can be terminated; system-critical processes are hard-blocked. Use suggest_restarts or get_top_processes first to identify the target.',
  {
    process_name: z
      .string()
      .describe('Name of the process to kill, e.g. "chrome.exe" or "Teams.exe"'),
  },
  async ({ process_name }) => {
    const result = await killProcess(process_name);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: disable_startup_item ──────────────────────────────────────────────
server.tool(
  'disable_startup_item',
  'Disable a Windows startup program so it no longer launches at login. Uses dry_run=true by default — set dry_run=false to actually remove it. Use get_startup_items to list all current startup entries.',
  {
    item_name: z
      .string()
      .describe('Name of the startup item to disable (as shown by get_startup_items)'),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true (default), only reports what would be done without making changes'),
  },
  async ({ item_name, dry_run }) => {
    const result = await disableStartupItem(item_name, dry_run);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_battery_health ────────────────────────────────────────────────
server.tool(
  'get_battery_health',
  'Report laptop battery health: charge level, charging status, design vs current capacity, wear percentage, estimated runtime, and cycle count. Returns gracefully on desktops.',
  {},
  async () => {
    const result = await getBatteryHealth();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_windows_update_status ────────────────────────────────────────
server.tool(
  'get_windows_update_status',
  'Check for pending Windows updates. Returns the count, KB numbers, download sizes, and whether any are security-critical. Does not install — just reports.',
  {},
  async () => {
    const result = await getWindowsUpdateStatus();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: get_event_log_errors ──────────────────────────────────────────────
server.tool(
  'get_event_log_errors',
  'Scan the Windows System and Application event logs for critical/error/warning events. Groups results by source so you can spot patterns. Useful for diagnosing crashes, driver failures, and service errors.',
  {
    hours_back: z
      .number()
      .min(1)
      .max(168)
      .optional()
      .default(24)
      .describe('How many hours back to scan (default: 24, max: 168 = 7 days)'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of log entries to return (default: 20)'),
  },
  async ({ hours_back, max_results }) => {
    const result = await getEventLogErrors(hours_back, max_results);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: set_display_scaling ───────────────────────────────────────────────
server.tool(
  'set_display_scaling',
  'Set Windows display scaling (DPI). Valid values: 100, 125, 150, 175, 200, 225, 250, 300, 350. Uses dry_run=true by default. A logout is required for the change to take effect.',
  {
    scaling_percent: z
      .number()
      .describe('Scaling percentage to set (100=normal, 125=recommended for HD, 150=common for 4K)'),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true (default), only reports what would change without writing to registry'),
  },
  async ({ scaling_percent, dry_run }) => {
    const result = await setDisplayScaling(scaling_percent, dry_run);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Tool: schedule_maintenance ─────────────────────────────────────────────
server.tool(
  'schedule_maintenance',
  'Create a Windows Task Scheduler job that automatically runs maintenance (deletes temp files, empties Recycle Bin) at a daily time you choose. Uses dry_run=true by default.',
  {
    time: z
      .string()
      .optional()
      .default('03:00')
      .describe('Daily run time in HH:mm format, e.g. "03:00" for 3 AM'),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true (default), describes what would be scheduled without creating the task'),
  },
  async ({ time, dry_run }) => {
    const result = await scheduleMaintenance(time, dry_run);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ─── Start server ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Windows Health MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
