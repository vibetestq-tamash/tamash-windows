import { execSync } from 'child_process';

export interface StartupItem {
  name: string;
  command: string;
  location: string;
  user: string;
  is_heavy: boolean;
}

export interface StartupItemsResult {
  timestamp: string;
  total_count: number;
  heavy_count: number;
  items: StartupItem[];
  summary: string;
}

const KNOWN_HEAVY_KEYWORDS = [
  'teams', 'docker', 'slack', 'spotify', 'discord', 'steam', 'epicgames',
  'onedrive', 'googledrive', 'dropbox', 'adobe', 'zoom', 'cisco',
  'browserstack', 'ollama', 'arattai',
];

export async function getStartupItems(): Promise<StartupItemsResult> {
  let items: StartupItem[] = [];

  try {
    const raw = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name, Command, Location, User | ConvertTo-Json -Compress"`,
      { timeout: 10000, encoding: 'utf-8' }
    ).trim();

    if (raw && raw !== 'null') {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      items = arr.map((s: { Name: string; Command: string; Location: string; User: string }) => {
        const nameLower = (s.Name ?? '').toLowerCase();
        const cmdLower = (s.Command ?? '').toLowerCase();
        const isHeavy = KNOWN_HEAVY_KEYWORDS.some(
          (kw) => nameLower.includes(kw) || cmdLower.includes(kw)
        );
        return {
          name: s.Name ?? 'Unknown',
          command: s.Command ?? '',
          location: s.Location ?? '',
          user: s.User ?? '',
          is_heavy: isHeavy,
        };
      });
    }
  } catch {
    items = [];
  }

  const heavyCount = items.filter((i) => i.is_heavy).length;

  const summary =
    items.length === 0
      ? 'No startup items found or query failed.'
      : `${items.length} startup program(s) — ${heavyCount} flagged as heavy/slow. Disable unwanted items in Task Manager > Startup tab.`;

  return {
    timestamp: new Date().toISOString(),
    total_count: items.length,
    heavy_count: heavyCount,
    items,
    summary,
  };
}
