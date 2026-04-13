import { execSync } from 'child_process';

export interface WindowsUpdate {
  title: string;
  kb: string | null;
  size_mb: number | null;
  category: string;
  is_important: boolean;
  is_security: boolean;
}

export interface WindowsUpdateStatusResult {
  pending_count: number;
  security_count: number;
  optional_count: number;
  total_size_mb: number | null;
  last_search_time: string | null;
  updates: WindowsUpdate[];
  wu_service_status: string;
  auto_update_enabled: boolean | null;
  summary: string;
}

function getWuServiceStatus(): string {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(Get-Service wuauserv).Status"`,
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    return raw.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function getAutoUpdateEnabled(): boolean | null {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(New-Object -ComObject Microsoft.Update.AutoUpdate).Settings.NotificationLevel"`,
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    const level = parseInt(raw, 10);
    // 0=NotConfigured, 1=Disabled, 2=NotifyBeforeDownload, 3=NotifyBeforeInstall, 4=Scheduled
    return level >= 2;
  } catch {
    return null;
  }
}

function getLastSearchTime(): string | null {
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastSearchSuccessDate | Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`,
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    return raw || null;
  } catch {
    return null;
  }
}

function queryPendingUpdates(): WindowsUpdate[] {
  try {
    // Use COM-based search (does not require PSWindowsUpdate module)
    const script = `
      $session = New-Object -ComObject Microsoft.Update.Session;
      $searcher = $session.CreateUpdateSearcher();
      $result = $searcher.Search('IsInstalled=0 and IsHidden=0');
      $updates = $result.Updates;
      $list = @();
      for ($i=0; $i -lt $updates.Count; $i++) {
        $u = $updates.Item($i);
        $kb = if ($u.KBArticleIDs.Count -gt 0) { 'KB' + $u.KBArticleIDs.Item(0) } else { $null };
        $sizeBytes = if ($u.MaxDownloadSize -gt 0) { $u.MaxDownloadSize } else { $null };
        $cat = if ($u.Categories.Count -gt 0) { $u.Categories.Item(0).Name } else { 'Other' };
        $list += @{
          Title = $u.Title;
          KB = $kb;
          SizeBytes = $sizeBytes;
          Category = $cat;
          IsImportant = ($u.AutoSelectOnWebSites -eq $true);
          IsSecurity = ($u.Categories | Where-Object { $_.Name -match 'Security' } | Measure-Object).Count -gt 0
        }
      }
      $list | ConvertTo-Json -Compress
    `.trim().replace(/\n\s*/g, ' ');

    const raw = execSync(
      `powershell -NoProfile -Command "${script}"`,
      { timeout: 60000, windowsHide: true }
    ).toString().trim();

    if (!raw || raw === 'null') return [];
    const parsed = JSON.parse(raw);
    const arr: any[] = Array.isArray(parsed) ? parsed : [parsed];

    return arr.map((u) => ({
      title: u.Title ?? 'Unknown',
      kb: u.KB ?? null,
      size_mb:
        u.SizeBytes && u.SizeBytes > 0
          ? Math.round((u.SizeBytes / 1024 / 1024) * 10) / 10
          : null,
      category: u.Category ?? 'Other',
      is_important: !!u.IsImportant,
      is_security: !!u.IsSecurity,
    }));
  } catch {
    return [];
  }
}

export async function getWindowsUpdateStatus(): Promise<WindowsUpdateStatusResult> {
  const [pending, wuStatus, autoUpdate, lastSearch] = await Promise.all([
    Promise.resolve(queryPendingUpdates()),
    Promise.resolve(getWuServiceStatus()),
    Promise.resolve(getAutoUpdateEnabled()),
    Promise.resolve(getLastSearchTime()),
  ]);

  const securityCount = pending.filter((u) => u.is_security).length;
  const optionalCount = pending.filter((u) => !u.is_important).length;
  const sizes = pending.map((u) => u.size_mb).filter((s): s is number => s !== null);
  const totalSizeMb = sizes.length > 0 ? Math.round(sizes.reduce((a, b) => a + b, 0) * 10) / 10 : null;

  let summary: string;
  if (pending.length === 0) {
    summary = 'Windows is up to date — no pending updates found.';
  } else {
    const parts: string[] = [`${pending.length} pending update${pending.length > 1 ? 's' : ''}`];
    if (securityCount > 0) parts.push(`${securityCount} security`);
    if (totalSizeMb !== null) parts.push(`~${totalSizeMb} MB download`);
    summary = parts.join(', ') + '. Run Windows Update to install.';
    if (securityCount > 0) summary += ' ⚠ Security updates should be installed promptly.';
  }

  return {
    pending_count: pending.length,
    security_count: securityCount,
    optional_count: optionalCount,
    total_size_mb: totalSizeMb,
    last_search_time: lastSearch,
    updates: pending,
    wu_service_status: wuStatus,
    auto_update_enabled: autoUpdate,
    summary,
  };
}
