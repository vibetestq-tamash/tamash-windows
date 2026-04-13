#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getSystemHealth } from './tools/get_system_health.js';
import { getTopProcesses } from './tools/get_top_processes.js';
import { analyzeSlowdown } from './tools/analyze_slowdown.js';
import { cleanTempFiles } from './tools/clean_temp_files.js';
import { optimizeForMeeting } from './tools/optimize_for_meeting.js';

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
