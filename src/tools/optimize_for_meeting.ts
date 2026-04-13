import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface OptimizeResult {
  timestamp: string;
  dry_run: boolean;
  meeting_in_minutes: number;
  actions_taken: ActionResult[];
  actions_skipped: ActionResult[];
  freed_ram_mb: number;
  summary: string;
}

interface ActionResult {
  action: string;
  target: string;
  status: 'done' | 'skipped' | 'failed';
  reason?: string;
}

// Processes that are safe to close before a meeting
const DISTRACTING_PROCESSES = [
  { name: 'Spotify.exe', label: 'Spotify (music)' },
  { name: 'Discord.exe', label: 'Discord' },
  { name: 'Steam.exe', label: 'Steam' },
  { name: 'EpicGamesLauncher.exe', label: 'Epic Games Launcher' },
  { name: 'slack.exe', label: 'Slack' },       // may want to keep, user decides
  { name: 'Telegram.exe', label: 'Telegram' },
  { name: 'WhatsApp.exe', label: 'WhatsApp' },
  { name: 'msteams.exe', label: 'Microsoft Teams (background instance)' },
];

// Background updaters safe to stop temporarily
const BACKGROUND_UPDATERS = [
  { name: 'OneDrive.exe', label: 'OneDrive sync' },
  { name: 'GoogleUpdate.exe', label: 'Google Update' },
  { name: 'MicrosoftEdgeUpdate.exe', label: 'Edge Update' },
  { name: 'AdobeUpdateService.exe', label: 'Adobe Update' },
  { name: 'SearchIndexer.exe', label: 'Windows Search Indexer' },
];

// Verify against allowlist
function getAllowedToKill(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    return (raw.safeToKillProcesses ?? []).map((p: string) => p.toLowerCase());
  } catch {
    return [];
  }
}

function isProcessRunning(processName: string): boolean {
  try {
    const result = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${processName.replace('.exe', '')}' -ErrorAction SilentlyContinue | Select-Object -First 1 Id"`,
      { timeout: 5000, encoding: 'utf-8' }
    ).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function killProcess(processName: string): boolean {
  try {
    execSync(
      `powershell -NoProfile -Command "Stop-Process -Name '${processName.replace('.exe', '')}' -Force -ErrorAction SilentlyContinue"`,
      { timeout: 8000 }
    );
    return true;
  } catch {
    return false;
  }
}

function setWindowsPowerPlan(highPerformance: boolean): boolean {
  const guid = highPerformance
    ? '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c' // High performance
    : '381b4222-f694-41f0-9685-ff5bb260df2e'; // Balanced
  try {
    execSync(`powercfg /setactive ${guid}`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function muteMicrophone(mute: boolean): boolean {
  const script = mute
    ? `$obj = New-Object -ComObject WScript.Shell; $obj.SendKeys([char]173)`
    : `$obj = New-Object -ComObject WScript.Shell; $obj.SendKeys([char]173)`;
  // Toggle mute (Windows mute key)
  try {
    execSync(`powershell -NoProfile -Command "${script}"`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export async function optimizeForMeeting(
  dryRun: boolean = false,
  minutesUntilMeeting: number = 5
): Promise<OptimizeResult> {
  const actions_taken: ActionResult[] = [];
  const actions_skipped: ActionResult[] = [];
  const allowedToKill = getAllowedToKill();
  let freedRamMb = 0;

  // 1. Kill distracting apps
  for (const proc of DISTRACTING_PROCESSES) {
    const allowed = allowedToKill.includes(proc.name.toLowerCase());
    if (!allowed) {
      actions_skipped.push({
        action: 'close_process',
        target: proc.label,
        status: 'skipped',
        reason: 'Not on safety allowlist',
      });
      continue;
    }

    const running = isProcessRunning(proc.name);
    if (!running) {
      actions_skipped.push({
        action: 'close_process',
        target: proc.label,
        status: 'skipped',
        reason: 'Not currently running',
      });
      continue;
    }

    if (dryRun) {
      actions_taken.push({
        action: 'close_process',
        target: proc.label,
        status: 'done',
        reason: 'DRY RUN — would have closed this',
      });
      freedRamMb += 150; // Estimate
    } else {
      const killed = killProcess(proc.name);
      actions_taken.push({
        action: 'close_process',
        target: proc.label,
        status: killed ? 'done' : 'failed',
        reason: killed ? undefined : 'Process did not respond to stop signal',
      });
      if (killed) freedRamMb += 150;
    }
  }

  // 2. Pause background updaters
  for (const proc of BACKGROUND_UPDATERS) {
    const allowed = allowedToKill.includes(proc.name.toLowerCase());
    if (!allowed) continue;

    const running = isProcessRunning(proc.name);
    if (!running) continue;

    if (dryRun) {
      actions_taken.push({
        action: 'pause_background_task',
        target: proc.label,
        status: 'done',
        reason: 'DRY RUN — would have paused',
      });
      freedRamMb += 50;
    } else {
      const killed = killProcess(proc.name);
      actions_taken.push({
        action: 'pause_background_task',
        target: proc.label,
        status: killed ? 'done' : 'failed',
      });
      if (killed) freedRamMb += 50;
    }
  }

  // 3. Switch to High Performance power plan
  if (dryRun) {
    actions_taken.push({
      action: 'set_power_plan',
      target: 'High Performance',
      status: 'done',
      reason: 'DRY RUN',
    });
  } else {
    const ok = setWindowsPowerPlan(true);
    actions_taken.push({
      action: 'set_power_plan',
      target: 'High Performance',
      status: ok ? 'done' : 'failed',
      reason: ok ? undefined : 'Requires elevated permissions',
    });
  }

  // 4. Remind about meeting
  const summaryParts: string[] = [];
  const closedCount = actions_taken.filter(
    (a) => a.action === 'close_process' && a.status === 'done'
  ).length;
  const pausedCount = actions_taken.filter(
    (a) => a.action === 'pause_background_task' && a.status === 'done'
  ).length;

  if (closedCount > 0) summaryParts.push(`Closed ${closedCount} distracting app(s)`);
  if (pausedCount > 0) summaryParts.push(`paused ${pausedCount} background updater(s)`);
  summaryParts.push('switched to High Performance power plan');

  const verb = dryRun ? 'Would have: ' : '';
  const timeNote = minutesUntilMeeting <= 5 ? 'Your PC is ready for the meeting.' : `Meeting in ${minutesUntilMeeting} min — system pre-warmed.`;

  const summary =
    actions_taken.length === 0
      ? `Nothing to optimize — system already clean. ${timeNote}`
      : `${verb}${summaryParts.join(', ')}. ${timeNote}`;

  return {
    timestamp: new Date().toISOString(),
    dry_run: dryRun,
    meeting_in_minutes: minutesUntilMeeting,
    actions_taken,
    actions_skipped,
    freed_ram_mb: freedRamMb,
    summary,
  };
}
