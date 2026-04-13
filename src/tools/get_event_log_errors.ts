import { execSync } from 'child_process';

export interface EventLogEntry {
  time: string;
  level: 'Critical' | 'Error' | 'Warning' | 'Information';
  log: string;
  source: string;
  event_id: number;
  message: string;
}

export interface EventSourceSummary {
  source: string;
  count: number;
  highest_level: string;
  sample_message: string;
}

export interface EventLogErrorsResult {
  hours_back: number;
  total_found: number;
  critical_count: number;
  error_count: number;
  warning_count: number;
  top_sources: EventSourceSummary[];
  recent_entries: EventLogEntry[];
  summary: string;
}

export async function getEventLogErrors(
  hoursBack: number = 24,
  maxResults: number = 20
): Promise<EventLogErrorsResult> {
  let entries: EventLogEntry[] = [];

  try {
    // Level 1=Critical, 2=Error, 3=Warning
    const script = `
      $since = (Get-Date).AddHours(-${Math.floor(hoursBack)});
      Get-WinEvent -FilterHashtable @{
        LogName = 'System','Application';
        Level = 1,2,3;
        StartTime = $since
      } -MaxEvents ${Math.max(maxResults, 100)} -ErrorAction SilentlyContinue |
      Sort-Object TimeCreated -Descending |
      Select-Object -First ${Math.max(maxResults, 100)} |
      ForEach-Object {
        @{
          Time = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss');
          Level = $_.LevelDisplayName;
          Log = $_.LogName;
          Source = $_.ProviderName;
          EventId = $_.Id;
          Message = ($_.Message -split '\\r?\\n')[0] -replace '\\s+', ' '
        }
      } | ConvertTo-Json -Compress
    `.trim().replace(/\n\s*/g, ' ');

    const raw = execSync(
      `powershell -NoProfile -Command "${script}"`,
      { timeout: 30000, windowsHide: true }
    ).toString().trim();

    if (raw && raw !== 'null') {
      const parsed = JSON.parse(raw);
      const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];
      entries = arr.map((e) => ({
        time: e.Time ?? '',
        level: e.Level ?? 'Error',
        log: e.Log ?? '',
        source: e.Source ?? '',
        event_id: e.EventId ?? 0,
        message: (e.Message ?? '').slice(0, 200),
      }));
    }
  } catch {
    // Get-WinEvent can throw if no events found in range — treat as empty
  }

  const criticalCount = entries.filter((e) => e.level === 'Critical').length;
  const errorCount = entries.filter((e) => e.level === 'Error').length;
  const warningCount = entries.filter((e) => e.level === 'Warning').length;

  // Group by source
  const sourceMap = new Map<string, { count: number; highest: string; sample: string }>();
  const levelOrder = { Critical: 0, Error: 1, Warning: 2, Information: 3 };
  for (const e of entries) {
    const existing = sourceMap.get(e.source);
    if (!existing) {
      sourceMap.set(e.source, { count: 1, highest: e.level, sample: e.message });
    } else {
      existing.count++;
      if ((levelOrder[e.level as keyof typeof levelOrder] ?? 99) < (levelOrder[existing.highest as keyof typeof levelOrder] ?? 99)) {
        existing.highest = e.level;
        existing.sample = e.message;
      }
    }
  }

  const topSources: EventSourceSummary[] = [...sourceMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([source, info]) => ({
      source,
      count: info.count,
      highest_level: info.highest,
      sample_message: info.sample.slice(0, 150),
    }));

  const recentEntries = entries.slice(0, maxResults);

  let summary: string;
  if (entries.length === 0) {
    summary = `No critical/error/warning events in the last ${hoursBack} hour${hoursBack !== 1 ? 's' : ''}. System looks clean.`;
  } else {
    const parts: string[] = [];
    if (criticalCount > 0) parts.push(`${criticalCount} critical`);
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? 's' : ''}`);
    if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
    summary = `Found ${parts.join(', ')} in the last ${hoursBack}h. Top source: ${topSources[0]?.source ?? 'unknown'} (${topSources[0]?.count ?? 0} events).`;
  }

  return {
    hours_back: hoursBack,
    total_found: entries.length,
    critical_count: criticalCount,
    error_count: errorCount,
    warning_count: warningCount,
    top_sources: topSources,
    recent_entries: recentEntries,
    summary,
  };
}
