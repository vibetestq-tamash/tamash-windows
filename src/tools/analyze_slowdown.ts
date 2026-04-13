import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SlowdownFinding {
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  culprits: string[];
  recommended_action: string;
}

export interface SlowdownAnalysisResult {
  timestamp: string;
  overall_verdict: string;
  findings: SlowdownFinding[];
  quick_wins: string[];
  estimated_recoverable_ram_mb: number;
}

function getSafeToKillNames(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    return (raw.safeToKillProcesses ?? []).map((p: string) => p.toLowerCase().replace('.exe', ''));
  } catch {
    return [];
  }
}

function getHighMemProcesses(): Array<{ name: string; memory_mb: number }> {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-Process | Sort-Object WorkingSet -Descending | Select-Object -First 20 Name,WorkingSet | ConvertTo-Json -Compress"`,
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    const list = JSON.parse(raw);
    const arr = Array.isArray(list) ? list : [list];
    return arr
      .map((p: { Name: string; WorkingSet: number }) => ({
        name: p.Name,
        memory_mb: Math.round(p.WorkingSet / 1e6),
      }))
      .filter((p) => p.memory_mb > 200);
  } catch {
    return [];
  }
}

function getStartupItems(): string[] {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name | ConvertTo-Json -Compress"`,
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((s: { Name: string }) => s.Name).filter(Boolean);
  } catch {
    return [];
  }
}

function getPageFileUsage(): { usedMb: number; totalMb: number } | null {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-WmiObject Win32_PageFileUsage | Select-Object AllocatedBaseSize,CurrentUsage | ConvertTo-Json -Compress"`,
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    const parsed = JSON.parse(raw);
    const pf = Array.isArray(parsed) ? parsed[0] : parsed;
    return { totalMb: pf.AllocatedBaseSize, usedMb: pf.CurrentUsage };
  } catch {
    return null;
  }
}

function getLowDiskDrives(): string[] {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-WmiObject Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { ($_.FreeSpace / $_.Size) -lt 0.10 } | Select-Object DeviceID | ConvertTo-Json -Compress"`,
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    if (!raw || raw === 'null') return [];
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((d: { DeviceID: string }) => d.DeviceID);
  } catch {
    return [];
  }
}

export async function analyzeSlowdown(): Promise<SlowdownAnalysisResult> {
  const findings: SlowdownFinding[] = [];
  const quickWins: string[] = [];

  const totalMemGb = os.totalmem() / 1e9;
  const freeMemGb = os.freemem() / 1e9;
  const memUsagePct = ((totalMemGb - freeMemGb) / totalMemGb) * 100;

  // --- RAM pressure ---
  if (memUsagePct > 85) {
    const heavyProcs = getHighMemProcesses();
    findings.push({
      category: 'Memory Pressure',
      severity: memUsagePct > 95 ? 'critical' : 'high',
      description: `RAM usage is at ${Math.round(memUsagePct)}% (${Math.round(freeMemGb * 1024)} MB free of ${Math.round(totalMemGb * 1024)} MB).`,
      culprits: heavyProcs.slice(0, 5).map((p) => `${p.name} (${p.memory_mb} MB)`),
      recommended_action:
        heavyProcs.length > 0
          ? `Close or restart: ${heavyProcs
              .slice(0, 3)
              .map((p) => p.name)
              .join(', ')}`
          : 'Consider upgrading RAM or reducing open applications.',
    });
    quickWins.push('Close memory-heavy applications to reclaim RAM immediately.');
  }

  // --- Page file usage (disk-based virtual memory = slow) ---
  const pf = getPageFileUsage();
  if (pf && pf.usedMb > 500) {
    findings.push({
      category: 'Virtual Memory (Page File) Active',
      severity: pf.usedMb > 2000 ? 'high' : 'medium',
      description: `Windows is using ${pf.usedMb} MB of page file (disk as RAM). This makes everything slow.`,
      culprits: ['Low physical RAM'],
      recommended_action:
        'Reduce open applications. If this is frequent, adding more RAM is the single best upgrade.',
    });
    quickWins.push('Restart background apps to reduce page file usage.');
  }

  // --- Startup bloat ---
  const startupItems = getStartupItems();
  if (startupItems.length > 8) {
    findings.push({
      category: 'Startup Program Bloat',
      severity: startupItems.length > 15 ? 'high' : 'medium',
      description: `${startupItems.length} programs launch at startup, slowing boot and consuming background resources.`,
      culprits: startupItems.slice(0, 8),
      recommended_action:
        'Open Task Manager > Startup tab and disable non-essential items. Aim for under 5 startup programs.',
    });
    quickWins.push('Disable unnecessary startup programs in Task Manager.');
  }

  // --- Low disk space ---
  const lowDrives = getLowDiskDrives();
  if (lowDrives.length > 0) {
    findings.push({
      category: 'Critical Disk Space',
      severity: 'critical',
      description: `Drive(s) ${lowDrives.join(', ')} have less than 10% free space. Windows needs free space to operate.`,
      culprits: lowDrives,
      recommended_action: 'Run clean_temp_files tool, then use Disk Cleanup or Storage Sense.',
    });
    quickWins.push(`Free up space on ${lowDrives.join(', ')} — run clean_temp_files.`);
  }

  // --- Uptime (memory leaks accumulate) ---
  const uptimeDays = os.uptime() / 86400;
  if (uptimeDays > 7) {
    findings.push({
      category: 'Long Uptime / Memory Leaks',
      severity: uptimeDays > 14 ? 'medium' : 'low',
      description: `PC has been running for ${Math.floor(uptimeDays)} days. Memory leaks and background processes accumulate over time.`,
      culprits: ['Extended uptime without restart'],
      recommended_action: 'Restart your PC to clear accumulated memory leaks and get a clean slate.',
    });
    quickWins.push('Restart your PC — it has been running for over a week.');
  }

  // --- Healthy verdict ---
  const highOrCritical = findings.filter((f) => f.severity === 'high' || f.severity === 'critical');
  const overallVerdict =
    findings.length === 0
      ? 'Your system looks healthy — no significant slowdown causes detected.'
      : highOrCritical.length > 0
      ? `Found ${highOrCritical.length} significant issue(s) causing slowdown. Address the HIGH/CRITICAL findings first.`
      : `Found ${findings.length} minor issue(s). Addressing these will improve responsiveness.`;

  const heavyProcs = getHighMemProcesses();
  const safeToKill = getSafeToKillNames();
  const recoverableRam = heavyProcs
    .filter((p) => safeToKill.includes(p.name.toLowerCase()))
    .reduce((sum, p) => sum + p.memory_mb, 0);

  return {
    timestamp: new Date().toISOString(),
    overall_verdict: overallVerdict,
    findings,
    quick_wins: quickWins,
    estimated_recoverable_ram_mb: recoverableRam,
  };
}
