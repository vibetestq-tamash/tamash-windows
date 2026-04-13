import { execSync } from 'child_process';
import * as os from 'os';

export interface SystemHealthResult {
  timestamp: string;
  overall_status: 'healthy' | 'warning' | 'critical';
  cpu: CpuHealth;
  memory: MemoryHealth;
  disk: DiskHealth[];
  uptime: UptimeInfo;
  summary: string;
}

interface CpuHealth {
  usage_percent: number;
  logical_cores: number;
  status: 'healthy' | 'warning' | 'critical';
}

interface MemoryHealth {
  total_gb: number;
  used_gb: number;
  free_gb: number;
  usage_percent: number;
  status: 'healthy' | 'warning' | 'critical';
}

interface DiskHealth {
  drive: string;
  total_gb: number;
  free_gb: number;
  used_percent: number;
  status: 'healthy' | 'warning' | 'critical';
}

interface UptimeInfo {
  seconds: number;
  human_readable: string;
}

function getCpuUsage(): number {
  try {
    const result = execSync(
      'powershell -NoProfile -Command "Get-WmiObject Win32_Processor | Measure-Object -Property LoadPercentage -Average | Select-Object -ExpandProperty Average"',
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    return parseFloat(result) || 0;
  } catch {
    return 0;
  }
}

function getDiskInfo(): DiskHealth[] {
  try {
    const raw = execSync(
      'powershell -NoProfile -Command "Get-WmiObject Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json"',
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    const parsed = JSON.parse(raw);
    const disks = Array.isArray(parsed) ? parsed : [parsed];
    return disks.map((d: { DeviceID: string; Size: number; FreeSpace: number }) => {
      const totalGb = d.Size / 1e9;
      const freeGb = d.FreeSpace / 1e9;
      const usedPct = ((totalGb - freeGb) / totalGb) * 100;
      return {
        drive: d.DeviceID,
        total_gb: Math.round(totalGb * 10) / 10,
        free_gb: Math.round(freeGb * 10) / 10,
        used_percent: Math.round(usedPct),
        status: usedPct > 90 ? 'critical' : usedPct > 75 ? 'warning' : 'healthy',
      } as DiskHealth;
    });
  } catch {
    return [];
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export async function getSystemHealth(): Promise<SystemHealthResult> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePct = (usedMem / totalMem) * 100;

  const cpuUsage = getCpuUsage();
  const disks = getDiskInfo();
  const uptimeSeconds = os.uptime();

  const cpuStatus: CpuHealth['status'] =
    cpuUsage > 90 ? 'critical' : cpuUsage > 70 ? 'warning' : 'healthy';
  const memStatus: MemoryHealth['status'] =
    memUsagePct > 90 ? 'critical' : memUsagePct > 75 ? 'warning' : 'healthy';

  const allStatuses = [cpuStatus, memStatus, ...disks.map((d) => d.status)];
  const overallStatus: SystemHealthResult['overall_status'] = allStatuses.includes('critical')
    ? 'critical'
    : allStatuses.includes('warning')
    ? 'warning'
    : 'healthy';

  const warnings: string[] = [];
  if (cpuStatus !== 'healthy') warnings.push(`CPU at ${Math.round(cpuUsage)}%`);
  if (memStatus !== 'healthy') warnings.push(`RAM at ${Math.round(memUsagePct)}%`);
  disks.forEach((d) => {
    if (d.status !== 'healthy') warnings.push(`${d.drive} disk at ${d.used_percent}%`);
  });

  const summary =
    warnings.length === 0
      ? 'System is running well. No issues detected.'
      : `Issues detected: ${warnings.join(', ')}.`;

  return {
    timestamp: new Date().toISOString(),
    overall_status: overallStatus,
    cpu: {
      usage_percent: Math.round(cpuUsage),
      logical_cores: os.cpus().length,
      status: cpuStatus,
    },
    memory: {
      total_gb: Math.round((totalMem / 1e9) * 10) / 10,
      used_gb: Math.round((usedMem / 1e9) * 10) / 10,
      free_gb: Math.round((freeMem / 1e9) * 10) / 10,
      usage_percent: Math.round(memUsagePct),
      status: memStatus,
    },
    disk: disks,
    uptime: {
      seconds: uptimeSeconds,
      human_readable: formatUptime(uptimeSeconds),
    },
    summary,
  };
}
