import { execSync } from 'child_process';

export interface DisplayScalingResult {
  dry_run: boolean;
  current_dpi: number | null;
  current_scaling_percent: number | null;
  requested_scaling_percent: number;
  target_dpi: number;
  action_taken: string;
  logout_required: boolean;
  undo_hint: string | null;
  summary: string;
}

const VALID_SCALING = [100, 125, 150, 175, 200, 225, 250, 300, 350];

// Standard 96 DPI = 100 % scaling. Windows uses the LogPixels value.
const scalingToDpi = (pct: number): number => Math.round((96 * pct) / 100);
const dpiToScaling = (dpi: number): number => Math.round((dpi / 96) * 100);

function getCurrentDpi(): number | null {
  // Primary source: HKCU\Control Panel\Desktop\LogPixels
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels"`,  
      { timeout: 8000, windowsHide: true }
    ).toString().trim();
    const v = parseInt(raw, 10);
    if (!isNaN(v) && v > 0) return v;
  } catch {
    // key may not exist; fall through
  }

  // Fallback: Win32_DesktopMonitor via WMI
  try {
    const raw = execSync(
      `powershell -NoProfile -Command "(Get-CimInstance -ClassName Win32_DesktopMonitor | Select-Object -First 1).PixelsPerXLogicalInch"`,
      { timeout: 10000, windowsHide: true }
    ).toString().trim();
    const v = parseInt(raw, 10);
    if (!isNaN(v) && v > 0) return v;
  } catch {
    // ignore
  }

  return null;
}

function setDpi(targetDpi: number): void {
  // Write to HKCU\Control Panel\Desktop\LogPixels + Win8DpiScaling override
  const script = `
    Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name 'LogPixels' -Value ${targetDpi} -Type DWord -Force;
    Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name 'Win8DpiScaling' -Value 1 -Type DWord -Force
  `.trim().replace(/\n\s*/g, '; ');

  execSync(`powershell -NoProfile -Command "${script}"`, {
    timeout: 10000,
    windowsHide: true,
  });
}

export async function setDisplayScaling(
  scalingPercent: number,
  dryRun: boolean = true
): Promise<DisplayScalingResult> {
  if (!VALID_SCALING.includes(scalingPercent)) {
    return {
      dry_run: dryRun,
      current_dpi: null,
      current_scaling_percent: null,
      requested_scaling_percent: scalingPercent,
      target_dpi: scalingToDpi(scalingPercent),
      action_taken: 'invalid_value',
      logout_required: false,
      undo_hint: null,
      summary: `Invalid scaling value ${scalingPercent}%. Valid options: ${VALID_SCALING.join(', ')}.`,
    };
  }

  const currentDpi = getCurrentDpi();
  const currentScaling = currentDpi !== null ? dpiToScaling(currentDpi) : null;
  const targetDpi = scalingToDpi(scalingPercent);

  if (currentScaling === scalingPercent) {
    return {
      dry_run: dryRun,
      current_dpi: currentDpi,
      current_scaling_percent: currentScaling,
      requested_scaling_percent: scalingPercent,
      target_dpi: targetDpi,
      action_taken: 'already_set',
      logout_required: false,
      undo_hint: null,
      summary: `Display scaling is already at ${scalingPercent}% — no change needed.`,
    };
  }

  let actionTaken: string;

  if (dryRun) {
    actionTaken = `Would set HKCU\\Control Panel\\Desktop\\LogPixels = ${targetDpi} (${scalingPercent}%)`;
  } else {
    try {
      setDpi(targetDpi);
      actionTaken = `Set LogPixels = ${targetDpi} (${scalingPercent}%)`;
    } catch (err: any) {
      return {
        dry_run: dryRun,
        current_dpi: currentDpi,
        current_scaling_percent: currentScaling,
        requested_scaling_percent: scalingPercent,
        target_dpi: targetDpi,
        action_taken: 'error',
        logout_required: false,
        undo_hint: null,
        summary: `Failed to update display scaling: ${err.message ?? err}`,
      };
    }
  }

  const undoHint =
    currentDpi !== null
      ? `To revert: Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' LogPixels ${currentDpi}`
      : null;

  const verb = dryRun ? 'Would change' : 'Changed';
  return {
    dry_run: dryRun,
    current_dpi: currentDpi,
    current_scaling_percent: currentScaling,
    requested_scaling_percent: scalingPercent,
    target_dpi: targetDpi,
    action_taken: actionTaken,
    logout_required: !dryRun,
    undo_hint: undoHint,
    summary: `${verb} display scaling from ${currentScaling ?? '?'}% to ${scalingPercent}%.${!dryRun ? ' Log out and back in for the change to take effect.' : ' Run with dry_run=false to apply.'}`,
  };
}
