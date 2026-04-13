import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface DisableStartupItemResult {
  item_name: string;
  dry_run: boolean;
  found: boolean;
  location: string | null;
  command_was: string | null;
  action_taken: string;
  undo_hint: string | null;
  summary: string;
}

function getAllStartupItems(): Array<{ Name: string; Command: string; Location: string }> {
  try {
    const script = `
      Get-CimInstance -ClassName Win32_StartupCommand |
        Select-Object Name, Command, Location |
        ConvertTo-Json -Compress
    `;
    const raw = execSync(`powershell -NoProfile -Command "${script.trim().replace(/\n\s*/g, ' ')}"`, {
      timeout: 15000,
      windowsHide: true,
    }).toString().trim();

    if (!raw || raw === 'null') return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function disableFromRegistry(itemName: string, location: string, dryRun: boolean): string {
  // Most user startup items live in HKCU Run; machine-wide items in HKLM Run
  const regPath =
    location.toLowerCase().includes('hklm') || location.toLowerCase().includes('machine')
      ? 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
      : 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';

  if (dryRun) {
    return `Would delete registry value "${itemName}" from ${regPath}`;
  }

  const script = `Remove-ItemProperty -Path '${regPath}' -Name '${itemName}' -ErrorAction Stop`;
  execSync(`powershell -NoProfile -Command "${script}"`, { timeout: 10000, windowsHide: true });
  return `Deleted registry value "${itemName}" from ${regPath}`;
}

function disableFromStartupFolder(itemName: string, command: string, dryRun: boolean): string {
  // command is a .lnk / .bat path in the startup folder
  const startupDir = execSync(
    `powershell -NoProfile -Command "[Environment]::GetFolderPath('Startup')"`,
    { timeout: 5000, windowsHide: true }
  )
    .toString()
    .trim();

  const candidates = [
    path.join(startupDir, `${itemName}.lnk`),
    path.join(startupDir, `${itemName}.bat`),
    path.join(startupDir, `${itemName}.vbs`),
    path.join(startupDir, `${itemName}`),
  ];

  const found = candidates.find((p) => fs.existsSync(p));

  if (!found) {
    // Try to derive from command path
    if (command && fs.existsSync(command)) {
      if (dryRun) return `Would delete shortcut/script: ${command}`;
      fs.unlinkSync(command);
      return `Deleted startup shortcut/script: ${command}`;
    }
    return `Could not locate startup folder file for "${itemName}" — manual removal may be needed`;
  }

  if (dryRun) return `Would delete startup file: ${found}`;
  fs.unlinkSync(found);
  return `Deleted startup file: ${found}`;
}

export async function disableStartupItem(
  itemName: string,
  dryRun: boolean = true
): Promise<DisableStartupItemResult> {
  const items = getAllStartupItems();
  const match = items.find(
    (i) => i.Name.toLowerCase() === itemName.toLowerCase()
  );

  if (!match) {
    return {
      item_name: itemName,
      dry_run: dryRun,
      found: false,
      location: null,
      command_was: null,
      action_taken: 'not_found',
      undo_hint: null,
      summary: `No startup item named "${itemName}" was found. Use get_startup_items to list all startup entries.`,
    };
  }

  const isFolder = match.Location.toLowerCase().includes('startup');

  let actionTaken: string;
  let undoHint: string | null = null;

  if (isFolder) {
    actionTaken = disableFromStartupFolder(match.Name, match.Command, dryRun);
    undoHint = `To re-enable, add a shortcut to: ${execSync('powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Startup\')"', { windowsHide: true }).toString().trim()}`;
  } else {
    actionTaken = disableFromRegistry(match.Name, match.Location, dryRun);
    const regPath = match.Location.toLowerCase().includes('hklm')
      ? 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
      : 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';
    undoHint = `To re-enable, run: New-ItemProperty -Path '${regPath}' -Name '${match.Name}' -Value '${match.Command}'`;
  }

  const verb = dryRun ? 'Would disable' : 'Disabled';
  return {
    item_name: match.Name,
    dry_run: dryRun,
    found: true,
    location: match.Location,
    command_was: match.Command,
    action_taken: actionTaken,
    undo_hint: undoHint,
    summary: `${verb} startup item "${match.Name}" (${match.Location}). ${dryRun ? 'Run again with dry_run=false to apply.' : 'Change takes effect on next login.'}`,
  };
}
