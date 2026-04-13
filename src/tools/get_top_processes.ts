import { execSync } from 'child_process';

export interface ProcessEntry {
  rank: number;
  name: string;
  pid: number;
  cpu_percent: number;
  memory_mb: number;
  status: string;
}

export interface TopProcessesResult {
  timestamp: string;
  sort_by: 'cpu' | 'memory';
  top_count: number;
  processes: ProcessEntry[];
  total_shown_cpu_percent: number;
  total_shown_memory_mb: number;
}

export async function getTopProcesses(
  sortBy: 'cpu' | 'memory' = 'cpu',
  limit: number = 10
): Promise<TopProcessesResult> {
  const safeLimit = Math.min(Math.max(1, limit), 50);

  const sortProperty = sortBy === 'cpu' ? 'CPU' : 'WorkingSet';
  const script = `
    $procs = Get-Process | Select-Object Name, Id, CPU, WorkingSet, Responding |
      Sort-Object ${sortProperty} -Descending |
      Select-Object -First ${safeLimit}
    $procs | ConvertTo-Json -Compress
  `;

  const raw = execSync(`powershell -NoProfile -Command "${script.replace(/\n/g, ' ')}"`, {
    timeout: 10000,
    encoding: 'utf-8',
  }).trim();

  const parsed = JSON.parse(raw);
  const rawList = Array.isArray(parsed) ? parsed : [parsed];

  const processes: ProcessEntry[] = rawList.map(
    (p: { Name: string; Id: number; CPU: number | null; WorkingSet: number; Responding: boolean }, i: number) => ({
      rank: i + 1,
      name: p.Name,
      pid: p.Id,
      cpu_percent: Math.round((p.CPU ?? 0) * 10) / 10,
      memory_mb: Math.round((p.WorkingSet / 1e6) * 10) / 10,
      status: p.Responding ? 'running' : 'not responding',
    })
  );

  return {
    timestamp: new Date().toISOString(),
    sort_by: sortBy,
    top_count: processes.length,
    processes,
    total_shown_cpu_percent: Math.round(processes.reduce((s, p) => s + p.cpu_percent, 0) * 10) / 10,
    total_shown_memory_mb: Math.round(processes.reduce((s, p) => s + p.memory_mb, 0) * 10) / 10,
  };
}
