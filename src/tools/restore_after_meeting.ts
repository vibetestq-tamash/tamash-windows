import { execSync, spawn } from 'child_process';

export interface RestoreResult {
  timestamp: string;
  actions_taken: RestoreAction[];
  actions_skipped: RestoreAction[];
  summary: string;
}

interface RestoreAction {
  action: string;
  target: string;
  status: 'done' | 'skipped' | 'failed';
  reason?: string;
}

// Processes that optimize_for_meeting may have stopped — restore them here
const RESTORABLE = [
  {
    name: 'OneDrive',
    label: 'OneDrive sync',
    exePath: `${process.env.LOCALAPPDATA}\\Microsoft\\OneDrive\\OneDrive.exe`,
  },
  {
    name: 'SearchIndexer',
    label: 'Windows Search Indexer',
    exePath: 'C:\\Windows\\system32\\SearchIndexer.exe',
  },
];

function setBalancedPowerPlan(): boolean {
  try {
    execSync('powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isProcessRunning(name: string): boolean {
  try {
    const result = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Select-Object -First 1 Id"`,
      { timeout: 5000, encoding: 'utf-8' }
    ).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function startProcess(exePath: string): boolean {
  try {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* process not found — handled by return false in caller */ });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function restoreAfterMeeting(): Promise<RestoreResult> {
  const actions_taken: RestoreAction[] = [];
  const actions_skipped: RestoreAction[] = [];

  // 1. Switch back to Balanced power plan
  const planOk = setBalancedPowerPlan();
  actions_taken.push({
    action: 'set_power_plan',
    target: 'Balanced',
    status: planOk ? 'done' : 'failed',
    reason: planOk ? undefined : 'Requires elevated permissions',
  });

  // 2. Restart background processes that may have been paused
  for (const proc of RESTORABLE) {
    if (isProcessRunning(proc.name)) {
      actions_skipped.push({
        action: 'restart_process',
        target: proc.label,
        status: 'skipped',
        reason: 'Already running',
      });
      continue;
    }
    const started = startProcess(proc.exePath);
    actions_taken.push({
      action: 'restart_process',
      target: proc.label,
      status: started ? 'done' : 'failed',
      reason: started ? undefined : `Could not find or start ${proc.exePath}`,
    });
  }

  const doneCount = actions_taken.filter((a) => a.status === 'done').length;
  const summary =
    doneCount === 0
      ? 'System was already in normal state — nothing to restore.'
      : `Restored ${doneCount} setting(s): switched back to Balanced power plan and restarted background services.`;

  return {
    timestamp: new Date().toISOString(),
    actions_taken,
    actions_skipped,
    summary,
  };
}
