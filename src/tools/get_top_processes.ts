import { execSync } from 'child_process';

export interface ProcessEntry {
  rank: number;
  name: string;
  instance_count: number;
  total_cpu_seconds: number;
  total_memory_mb: number;
  status: string;
}

export interface TopProcessesResult {
  timestamp: string;
  sort_by: 'cpu' | 'memory';
  top_count: number;
  processes: ProcessEntry[];
  total_shown_cpu_seconds: number;
  total_shown_memory_mb: number;
}

export async function getTopProcesses(
  sortBy: 'cpu' | 'memory' = 'cpu',
  limit: number = 10
): Promise<TopProcessesResult> {
  const safeLimit = Math.min(Math.max(1, limit), 50);

  // Fetch all processes then aggregate client-side to avoid duplicates
  const cmd = `powershell -NoProfile -Command "Get-Process | Select-Object Name, CPU, WorkingSet, Responding | ConvertTo-Json -Compress"`;
  const raw = execSync(cmd, { timeout: 10000, encoding: 'utf-8' }).trim();

  const rawList: Array<{ Name: string; CPU: number | null; WorkingSet: number; Responding: boolean }> =
    JSON.parse(raw);

  // Aggregate by process name
  const grouped = new Map<string, { totalCpu: number; totalMem: number; count: number; anyNotResponding: boolean }>();
  for (const p of rawList) {
    const name = p.Name;
    const existing = grouped.get(name) ?? { totalCpu: 0, totalMem: 0, count: 0, anyNotResponding: false };
    grouped.set(name, {
      totalCpu: existing.totalCpu + (p.CPU ?? 0),
      totalMem: existing.totalMem + p.WorkingSet,
      count: existing.count + 1,
      anyNotResponding: existing.anyNotResponding || !p.Responding,
    });
  }

  const sorted = [...grouped.entries()]
    .sort((a, b) =>
      sortBy === 'cpu'
        ? b[1].totalCpu - a[1].totalCpu
        : b[1].totalMem - a[1].totalMem
    )
    .slice(0, safeLimit);

  const processes: ProcessEntry[] = sorted.map(([name, data], i) => ({
    rank: i + 1,
    name,
    instance_count: data.count,
    total_cpu_seconds: Math.round(data.totalCpu * 10) / 10,
    total_memory_mb: Math.round((data.totalMem / 1e6) * 10) / 10,
    status: data.anyNotResponding ? 'some not responding' : 'running',
  }));

  return {
    timestamp: new Date().toISOString(),
    sort_by: sortBy,
    top_count: processes.length,
    processes,
    total_shown_cpu_seconds: Math.round(processes.reduce((s, p) => s + p.total_cpu_seconds, 0) * 10) / 10,
    total_shown_memory_mb: Math.round(processes.reduce((s, p) => s + p.total_memory_mb, 0) * 10) / 10,
  };
}
