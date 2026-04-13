import { execSync } from 'child_process';

export interface BatteryInfo {
  present: boolean;
  name: string | null;
  status: string;
  charge_percent: number | null;
  charging: boolean | null;
  design_capacity_mwh: number | null;
  full_charge_capacity_mwh: number | null;
  health_percent: number | null;
  estimated_hours_remaining: number | null;
  estimated_minutes_remaining: number | null;
  cycle_count: number | null;
  wear_level: string;
  summary: string;
}

function wearLevel(healthPct: number): string {
  if (healthPct >= 80) return 'good';
  if (healthPct >= 60) return 'fair';
  if (healthPct >= 40) return 'poor';
  return 'replace_soon';
}

export async function getBatteryHealth(): Promise<BatteryInfo> {
  // --- Basic battery info via WMI ---
  let basic: any = null;
  try {
    const script = `
      Get-WmiObject Win32_Battery |
        Select-Object Name, BatteryStatus, EstimatedChargeRemaining, EstimatedRunTime |
        ConvertTo-Json -Compress
    `;
    const raw = execSync(
      `powershell -NoProfile -Command "${script.trim().replace(/\n\s*/g, ' ')}"`,
      { timeout: 15000, windowsHide: true }
    ).toString().trim();

    if (raw && raw !== 'null') {
      const parsed = JSON.parse(raw);
      basic = Array.isArray(parsed) ? parsed[0] : parsed;
    }
  } catch {
    // no battery / WMI unavailable
  }

  if (!basic) {
    return {
      present: false,
      name: null,
      status: 'no_battery',
      charge_percent: null,
      charging: null,
      design_capacity_mwh: null,
      full_charge_capacity_mwh: null,
      health_percent: null,
      estimated_hours_remaining: null,
      estimated_minutes_remaining: null,
      cycle_count: null,
      wear_level: 'n/a',
      summary: 'No battery detected — this appears to be a desktop or the battery driver is not loaded.',
    };
  }

  // BatteryStatus: 1=discharging, 2=AC+battery, 3=fully charged, 6=charging, 7=charging+high, 8=charging+low
  const statusCode: number = basic.BatteryStatus ?? 0;
  const charging = statusCode === 2 || statusCode === 6 || statusCode === 7 || statusCode === 8 || statusCode === 3;
  const statusMap: Record<number, string> = {
    1: 'discharging',
    2: 'ac_connected',
    3: 'fully_charged',
    4: 'low',
    5: 'critical',
    6: 'charging',
    7: 'charging_high',
    8: 'charging_low',
    9: 'charging_critical',
    10: 'undefined',
    11: 'partially_charged',
  };
  const status = statusMap[statusCode] ?? 'unknown';
  const chargePct = basic.EstimatedChargeRemaining ?? null;

  // Estimated runtime: WMI returns minutes; 71582788 = unknown
  const rawRunTime: number = basic.EstimatedRunTime ?? 0;
  const validRunTime = rawRunTime > 0 && rawRunTime < 71582788;
  const minutesLeft = validRunTime ? rawRunTime : null;
  const hoursLeft = minutesLeft !== null ? Math.round((minutesLeft / 60) * 10) / 10 : null;

  // --- Capacity data via BatteryStaticData / BatteryFullChargedCapacity ---
  let designCapacity: number | null = null;
  let fullChargeCapacity: number | null = null;
  let cycleCount: number | null = null;

  try {
    const capScript = `
      $static = Get-WmiObject -Namespace 'root\\WMI' -Class BatteryStaticData -ErrorAction SilentlyContinue;
      $full   = Get-WmiObject -Namespace 'root\\WMI' -Class BatteryFullChargedCapacity -ErrorAction SilentlyContinue;
      $cycle  = Get-WmiObject -Namespace 'root\\WMI' -Class BatteryCycleCount -ErrorAction SilentlyContinue;
      @{
        DesignedCapacity = if($static) {$static.DesignedCapacity} else {$null};
        FullChargedCapacity = if($full) {$full.FullChargedCapacity} else {$null};
        CycleCount = if($cycle) {$cycle.CycleCount} else {$null}
      } | ConvertTo-Json -Compress
    `;
    const raw2 = execSync(
      `powershell -NoProfile -Command "${capScript.trim().replace(/\n\s*/g, ' ')}"`,
      { timeout: 15000, windowsHide: true }
    ).toString().trim();

    if (raw2 && raw2 !== 'null') {
      const cap = JSON.parse(raw2);
      designCapacity = cap.DesignedCapacity ?? null;
      fullChargeCapacity = cap.FullChargedCapacity ?? null;
      cycleCount = cap.CycleCount ?? null;
    }
  } catch {
    // capacity WMI classes may not exist on all systems
  }

  const healthPct =
    designCapacity && fullChargeCapacity && designCapacity > 0
      ? Math.round((fullChargeCapacity / designCapacity) * 100)
      : null;

  const wear = healthPct !== null ? wearLevel(healthPct) : 'unknown';

  let summary = `Battery ${chargePct ?? '?'}% (${status}).`;
  if (healthPct !== null) summary += ` Health: ${healthPct}% (${wear}).`;
  if (hoursLeft !== null) summary += ` ~${hoursLeft}h remaining.`;
  if (cycleCount !== null) summary += ` ${cycleCount} charge cycles.`;
  if (!charging && chargePct !== null && chargePct < 20) {
    summary += ' ⚠ Low battery — plug in soon.';
  }
  if (wear === 'poor' || wear === 'replace_soon') {
    summary += ' ⚠ Battery wear is significant — consider replacement.';
  }

  return {
    present: true,
    name: basic.Name ?? 'Battery',
    status,
    charge_percent: chargePct,
    charging,
    design_capacity_mwh: designCapacity,
    full_charge_capacity_mwh: fullChargeCapacity,
    health_percent: healthPct,
    estimated_hours_remaining: hoursLeft,
    estimated_minutes_remaining: minutesLeft,
    cycle_count: cycleCount,
    wear_level: wear,
    summary,
  };
}
