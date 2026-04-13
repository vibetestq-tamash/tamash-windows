import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CleanResult {
  timestamp: string;
  dry_run: boolean;
  directories_scanned: number;
  files_found: number;
  files_deleted: number;
  files_locked_skipped: number;
  space_freed_mb: number;
  errors: string[];
  details: CleanedDirectory[];
  summary: string;
}

interface CleanedDirectory {
  path: string;
  files_deleted: number;
  space_freed_mb: number;
  skipped: number;
  locked: number;
}

// Expand Windows environment variable strings like %TEMP%
function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (_, key) => process.env[key] ?? `%${key}%`);
}

// Resolve safe paths to clean from allowlist (temp dirs + browser caches)
function getSafeTempPaths(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    const temp = (raw.safePaths?.tempDirectories ?? []).map(expandEnvVars);
    const browsers = (raw.safePaths?.browserCaches ?? []).map(expandEnvVars);
    return [...temp, ...browsers];
  } catch {
    return [os.tmpdir()];
  }
}

// Recursively calculate directory size in bytes
function getTreeSize(dirPath: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      try {
        total += entry.isDirectory() ? getTreeSize(full) : fs.statSync(full).size;
      } catch { /* locked/inaccessible file */ }
    }
  } catch { /* directory unreadable */ }
  return total;
}

function getForbiddenPaths(): string[] {
  try {
    const allowlistPath = path.join(__dirname, '..', '..', 'safety', 'allowlist.json');
    const raw = JSON.parse(fs.readFileSync(allowlistPath, 'utf-8'));
    return (raw.forbiddenPaths ?? []).map(expandEnvVars).map((p: string) => p.toLowerCase());
  } catch {
    return ['c:\\windows\\system32', 'c:\\windows\\syswow64', 'c:\\program files'];
  }
}

function isPathSafe(filePath: string, forbidden: string[]): boolean {
  const lower = filePath.toLowerCase();
  return !forbidden.some((f) => lower.startsWith(f));
}

// Try to open the file exclusively for writing. If another process holds an
// open handle, Windows will return EBUSY / EPERM / EACCES.
// For directories, attempt a non-destructive rename-to-self as the lock probe.
function isFileLocked(filePath: string, isDir: boolean): boolean {
  if (isDir) {
    // A directory with open handles will fail rename on Windows
    try {
      fs.renameSync(filePath, filePath);
      return false;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
    }
  }
  // For files: open read-write; if locked exclusively by another process this throws
  try {
    const fd = fs.openSync(filePath, fs.constants.O_RDWR);
    fs.closeSync(fd);
    return false;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  }
}

function cleanDirectory(
  dirPath: string,
  dryRun: boolean,
  maxAgeDays: number,
  forbidden: string[]
): CleanedDirectory {
  const result: CleanedDirectory = {
    path: dirPath,
    files_deleted: 0,
    space_freed_mb: 0,
    skipped: 0,
    locked: 0,
  };

  if (!fs.existsSync(dirPath)) return result;

  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (!isPathSafe(fullPath, forbidden)) {
      result.skipped++;
      continue;
    }

    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs > cutoffMs) {
        result.skipped++;
        continue;
      }

      const sizeBytes = entry.isFile() ? stat.size : entry.isDirectory() ? getTreeSize(fullPath) : 0;

      if (!dryRun) {
        // Lock check — never delete a file/dir that another process has open
        if (isFileLocked(fullPath, entry.isDirectory())) {
          result.locked++;
          continue;
        }
        if (entry.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }

      result.files_deleted++;
      result.space_freed_mb += sizeBytes / 1e6;
    } catch {
      result.skipped++;
    }
  }

  result.space_freed_mb = Math.round(result.space_freed_mb * 10) / 10;
  return result;
}

// Also run Windows built-in cleanmgr silently for deeper system cleanup (real mode only)
function runWindowsCleanmgr(): void {
  try {
    execSync('cleanmgr /sagerun:1', { timeout: 60000 });
  } catch {
    // Non-blocking — cleanmgr may not be configured
  }
}

export async function cleanTempFiles(
  dryRun: boolean = true,
  maxAgeDays: number = 7
): Promise<CleanResult> {
  const safePaths = getSafeTempPaths();
  const forbidden = getForbiddenPaths();
  const errors: string[] = [];
  const details: CleanedDirectory[] = [];

  let totalFiles = 0;
  let totalDeleted = 0;
  let totalSpaceMb = 0;
  let totalScanned = 0;
  let totalLocked = 0;

  for (const dirPath of safePaths) {
    if (!fs.existsSync(dirPath)) continue;
    totalScanned++;

    try {
      const result = cleanDirectory(dirPath, dryRun, maxAgeDays, forbidden);
      details.push(result);
      totalFiles += result.files_deleted + result.skipped;
      totalDeleted += result.files_deleted;
      totalSpaceMb += result.space_freed_mb;
      totalLocked += result.locked;
    } catch (err) {
      errors.push(`Failed to process ${dirPath}: ${(err as Error).message}`);
    }
  }

  // Kick off cleanmgr in the background (non-blocking) when not a dry run
  if (!dryRun) {
    try {
      runWindowsCleanmgr();
    } catch {
      // Ignore — optional enhancement
    }
  }

  const summaryVerb = dryRun ? 'Would free' : 'Freed';
  const lockedNote = totalLocked > 0 ? ` ${totalLocked} file(s) skipped — locked by another process.` : '';
  const summary =
    totalDeleted === 0
      ? dryRun
        ? 'No cleanable files found older than the specified age.'
        : `Nothing to clean — temp directories are already tidy.${lockedNote}`
      : `${summaryVerb} ${Math.round(totalSpaceMb)} MB by removing ${totalDeleted} file(s) from ${totalScanned} temp director${totalScanned === 1 ? 'y' : 'ies'}.${lockedNote}`;

  return {
    timestamp: new Date().toISOString(),
    dry_run: dryRun,
    directories_scanned: totalScanned,
    files_found: totalFiles,
    files_deleted: totalDeleted,
    files_locked_skipped: totalLocked,
    space_freed_mb: Math.round(totalSpaceMb * 10) / 10,
    errors,
    details,
    summary,
  };
}
