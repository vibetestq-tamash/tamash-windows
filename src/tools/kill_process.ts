import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface KillProcessResult {
  timestamp: string;
  target_name: string;
  instances_found: number;
  instances_killed: number;
  instances_skipped: number;
  errors: string[];
  summary: string;
}

function getAllowedToKill(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    return (raw.safeToKillProcesses ?? []).map((p: string) => p.toLowerCase().replace('.exe', ''));
  } catch {
    return [];
  }
}

function getForbiddenProcesses(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    return (raw.forbiddenProcesses ?? []).map((p: string) => p.toLowerCase().replace('.exe', ''));
  } catch {
    return ['lsass', 'svchost', 'csrss', 'winlogon', 'services', 'smss', 'system', 'explorer', 'dwm'];
  }
}

function getRunningInstances(name: string): number[] {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id | ConvertTo-Json -Compress"`,
      { timeout: 6000, encoding: 'utf-8' }
    ).trim();
    if (!raw || raw === 'null') return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function killPid(pid: number): { ok: boolean; error?: string } {
  try {
    execSync(
      `powershell -NoProfile -Command "Stop-Process -Id ${pid} -Force -ErrorAction Stop"`,
      { timeout: 8000 }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] };
  }
}

export async function killProcess(processName: string): Promise<KillProcessResult> {
  const name = processName.replace(/\.exe$/i, '').trim();
  const nameLower = name.toLowerCase();

  const forbidden = getForbiddenProcesses();
  if (forbidden.includes(nameLower)) {
    return {
      timestamp: new Date().toISOString(),
      target_name: name,
      instances_found: 0,
      instances_killed: 0,
      instances_skipped: 0,
      errors: [`'${name}' is a protected system process and cannot be killed.`],
      summary: `Blocked: '${name}' is on the forbidden list. This process is critical to Windows.`,
    };
  }

  const allowedList = getAllowedToKill();
  if (!allowedList.includes(nameLower)) {
    return {
      timestamp: new Date().toISOString(),
      target_name: name,
      instances_found: 0,
      instances_killed: 0,
      instances_skipped: 0,
      errors: [`'${name}' is not on the safety allowlist. Add it to safety/allowlist.json safeToKillProcesses to enable.`],
      summary: `Blocked: '${name}' is not on the allowlist. Edit safety/allowlist.json to permit it.`,
    };
  }

  const pids = getRunningInstances(name);
  if (pids.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      target_name: name,
      instances_found: 0,
      instances_killed: 0,
      instances_skipped: 0,
      errors: [],
      summary: `'${name}' is not currently running.`,
    };
  }

  const errors: string[] = [];
  let killed = 0;
  let skipped = 0;

  for (const pid of pids) {
    const result = killPid(pid);
    if (result.ok) {
      killed++;
    } else {
      skipped++;
      if (result.error) errors.push(`PID ${pid}: ${result.error}`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    target_name: name,
    instances_found: pids.length,
    instances_killed: killed,
    instances_skipped: skipped,
    errors,
    summary:
      killed === pids.length
        ? `Killed all ${killed} instance(s) of '${name}'.`
        : `Killed ${killed} of ${pids.length} instance(s) of '${name}'. ${skipped} could not be stopped.`,
  };
}
