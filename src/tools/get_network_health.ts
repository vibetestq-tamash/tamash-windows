import { execSync } from 'child_process';

export interface NetworkHealthResult {
  timestamp: string;
  overall_status: 'healthy' | 'warning' | 'critical' | 'offline';
  latency: LatencyResult[];
  active_connections: number;
  adapters: NetworkAdapter[];
  summary: string;
}

interface LatencyResult {
  host: string;
  latency_ms: number | null;
  status: 'reachable' | 'timeout';
}

interface NetworkAdapter {
  name: string;
  status: string;
  mac_address: string;
}

function pingHost(host: string): LatencyResult {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Test-Connection -ComputerName ${host} -Count 2 -ErrorAction Stop | Select-Object -ExpandProperty ResponseTime | Measure-Object -Average | Select-Object -ExpandProperty Average"`,
      { timeout: 10000, encoding: 'utf-8' }
    ).trim();
    const ms = parseFloat(raw);
    return { host, latency_ms: Math.round(ms), status: 'reachable' };
  } catch {
    return { host, latency_ms: null, status: 'timeout' };
  }
}

function getActiveConnectionCount(): number {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object).Count"`,
      { timeout: 5000, encoding: 'utf-8' }
    ).trim();
    return parseInt(raw) || 0;
  } catch {
    return 0;
  }
}

function getAdapters(): NetworkAdapter[] {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.Status -ne 'Not Present' } | Select-Object Name, Status, MacAddress | ConvertTo-Json -Compress"`,
      { timeout: 8000, encoding: 'utf-8' }
    ).trim();
    if (!raw || raw === 'null') return [];
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((a: { Name: string; Status: string; MacAddress: string }) => ({
      name: a.Name,
      status: a.Status,
      mac_address: a.MacAddress,
    }));
  } catch {
    return [];
  }
}

export async function getNetworkHealth(): Promise<NetworkHealthResult> {
  const targets = ['8.8.8.8', '1.1.1.1'];
  const latency = targets.map(pingHost);
  const activeConnections = getActiveConnectionCount();
  const adapters = getAdapters();

  const reachable = latency.filter((l) => l.status === 'reachable');
  const avgLatency =
    reachable.length > 0
      ? reachable.reduce((s, l) => s + (l.latency_ms ?? 0), 0) / reachable.length
      : null;

  let overallStatus: NetworkHealthResult['overall_status'];
  if (reachable.length === 0) {
    overallStatus = 'offline';
  } else if (avgLatency !== null && avgLatency > 150) {
    overallStatus = 'critical';
  } else if (avgLatency !== null && avgLatency > 60) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'healthy';
  }

  const summary =
    overallStatus === 'offline'
      ? 'No internet connectivity detected.'
      : `Internet latency: ${Math.round(avgLatency!)}ms avg. ${activeConnections} established TCP connections.`;

  return {
    timestamp: new Date().toISOString(),
    overall_status: overallStatus,
    latency,
    active_connections: activeConnections,
    adapters,
    summary,
  };
}
