import { execSync } from 'child_process';

export interface RestartSuggestion {
  app: string;
  instance_count: number;
  oldest_running_hours: number;
  current_memory_mb: number;
  estimated_clean_memory_mb: number;
  estimated_savings_mb: number;
  reason: string;
  suggested_action: string;
  severity: 'info' | 'suggested' | 'recommended' | 'strongly_recommended';
}

export interface SuggestRestartsResult {
  timestamp: string;
  suggestions: RestartSuggestion[];
  total_potential_savings_mb: number;
  summary: string;
}

// Approximate memory (MB) a freshly-started process uses.
// Everything above this is considered accumulated bloat.
const FRESH_MEMORY_MB: Record<string, number> = {
  chrome:          300,
  msedge:          300,
  firefox:         250,
  Code:            400,  // VS Code
  idea64:          600,  // IntelliJ IDEA
  devenv:          700,  // Visual Studio
  slack:           300,
  msteams:         400,
  Spotify:         180,
  discord:         250,
  zoom:            300,
  Outlook:         250,
  WINWORD:         120,
  EXCEL:           120,
  POWERPNT:        120,
  docker:          300,
  ollama:          200,
};

// Minimum uptime (hours) before a process is eligible for a suggestion
const MIN_UPTIME_HOURS: Record<string, number> = {
  chrome:   4,
  msedge:   4,
  firefox:  4,
  Code:     8,
  idea64:   8,
  devenv:   8,
  slack:    12,
  msteams:  12,
  Spotify:  6,
  discord:  6,
};
const DEFAULT_MIN_UPTIME_HOURS = 6;

// Chrome/Edge/Firefox spin up one process per tab + ~5 infrastructure processes
function estimateTabs(name: string, instanceCount: number): number | null {
  if (!['chrome', 'msedge', 'firefox'].includes(name.toLowerCase())) return null;
  return Math.max(0, instanceCount - 5);
}

export async function suggestRestarts(): Promise<SuggestRestartsResult> {
  let rawList: Array<{ Name: string; WorkingSet: number; StartTime: string | null }> = [];
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-Process | Select-Object Name, WorkingSet, @{N='StartTime';E={if($_.StartTime){$_.StartTime.ToString('o')}else{$null}}} | ConvertTo-Json -Compress"`,
      { timeout: 12000, encoding: 'utf-8' }
    ).trim();
    const parsed = JSON.parse(out);
    rawList = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rawList = [];
  }

  const now = Date.now();

  // Aggregate by name: total memory + oldest start time
  const grouped = new Map<string, { totalMem: number; count: number; oldestStart: number | null }>();
  for (const p of rawList) {
    const startMs = p.StartTime ? new Date(p.StartTime).getTime() : null;
    const ex = grouped.get(p.Name) ?? { totalMem: 0, count: 0, oldestStart: null };
    grouped.set(p.Name, {
      totalMem: ex.totalMem + (p.WorkingSet ?? 0),
      count: ex.count + 1,
      oldestStart:
        ex.oldestStart === null ? startMs
        : startMs === null     ? ex.oldestStart
        : Math.min(ex.oldestStart, startMs),
    });
  }

  const suggestions: RestartSuggestion[] = [];

  for (const [name, data] of grouped) {
    const freshMb = FRESH_MEMORY_MB[name];
    if (!freshMb) continue;

    const currentMb = Math.round(data.totalMem / 1e6);
    if (currentMb <= freshMb) continue;

    const uptimeHours =
      data.oldestStart !== null
        ? Math.round(((now - data.oldestStart) / 3600000) * 10) / 10
        : null;

    const minHours = MIN_UPTIME_HOURS[name] ?? DEFAULT_MIN_UPTIME_HOURS;
    if (uptimeHours === null || uptimeHours < minHours) continue;

    const savingsMb = Math.round(currentMb - freshMb);
    if (savingsMb < 100) continue;

    const tabs = estimateTabs(name, data.count);
    const bloatRatio = currentMb / freshMb;

    const reason =
      tabs !== null && tabs > 0
        ? `${name} has ~${tabs} open tab(s) across ${data.count} processes and has been running for ${uptimeHours}h. Browsers accumulate memory with tab count and uptime.`
        : `${name} has been running for ${uptimeHours}h with ${data.count} instance(s). Current: ${currentMb} MB vs fresh baseline ~${freshMb} MB.`;

    const severity: RestartSuggestion['severity'] =
      bloatRatio >= 4 || uptimeHours >= 24 ? 'strongly_recommended'
      : bloatRatio >= 2.5 || uptimeHours >= 12 ? 'recommended'
      : bloatRatio >= 1.5 ? 'suggested'
      : 'info';

    const suggested_action =
      tabs !== null
        ? `Restart ${name} — reopen only essential tabs (currently ~${tabs} open).`
        : `Restart ${name} — save your work first.`;

    suggestions.push({
      app: name,
      instance_count: data.count,
      oldest_running_hours: uptimeHours,
      current_memory_mb: currentMb,
      estimated_clean_memory_mb: freshMb,
      estimated_savings_mb: savingsMb,
      reason,
      suggested_action,
      severity,
    });
  }

  // Sort by estimated savings descending
  suggestions.sort((a, b) => b.estimated_savings_mb - a.estimated_savings_mb);

  const totalSavings = suggestions.reduce((s, r) => s + r.estimated_savings_mb, 0);

  const summary =
    suggestions.length === 0
      ? 'No restart suggestions — all apps are within normal memory ranges.'
      : `Restarting ${suggestions.length} app(s) could free ~${totalSavings} MB of RAM. Biggest win: restart ${suggestions[0].app} to save ~${suggestions[0].estimated_savings_mb} MB.`;

  return {
    timestamp: new Date().toISOString(),
    suggestions,
    total_potential_savings_mb: totalSavings,
    summary,
  };
}
