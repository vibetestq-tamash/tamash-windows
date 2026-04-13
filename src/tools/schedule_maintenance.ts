import { execSync } from 'child_process';

export interface ScheduleMaintenanceResult {
  dry_run: boolean;
  task_name: string;
  scheduled_time: string;
  action: string;
  action_description: string;
  task_exists_already: boolean;
  result: 'registered' | 'already_exists' | 'dry_run' | 'error';
  manage_hint: string;
  summary: string;
}

// The maintenance task runs win-tamash and calls clean_temp_files via stdin JSON-RPC.
// Since win-tamash is a stdio MCP server, the simplest schedulable action is a small
// wrapper PowerShell script that invokes the Node binary directly and pipes a request.
//
// For simplicity we schedule a PowerShell script that runs the built-in Windows
// Disk Cleanup (cleanmgr /sagerun:1) AND deletes the standard %TEMP% folder contents.
// Advanced users can customise the task action after creation.

const TASK_NAME = 'win-tamash-maintenance';

function taskExists(taskName: string): boolean {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName"`,
      { timeout: 10000, windowsHide: true }
    ).toString().trim();
    return out.toLowerCase() === taskName.toLowerCase();
  } catch {
    return false;
  }
}

function registerTask(taskName: string, timeStr: string): void {
  // Validate time format HH:mm
  if (!/^\d{2}:\d{2}$/.test(timeStr)) {
    throw new Error(`Invalid time format "${timeStr}". Use HH:mm (e.g. "03:00").`);
  }

  // Build a minimal maintenance action: delete TEMP, empty Recycle Bin
  const actionScript =
    `Remove-Item -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue; ` +
    `Clear-RecycleBin -Force -ErrorAction SilentlyContinue`;

  const script = `
    $action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NonInteractive -WindowStyle Hidden -Command "${actionScript}"';
    $trigger   = New-ScheduledTaskTrigger -Daily -At '${timeStr}';
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -RunLevel Highest;
    $settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 1) -StartWhenAvailable;
    Register-ScheduledTask -TaskName '${taskName}' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop
  `.trim().replace(/\n\s*/g, ' ');

  execSync(`powershell -NoProfile -Command "${script}"`, {
    timeout: 30000,
    windowsHide: true,
  });
}

export async function scheduleMaintenance(
  time: string = '03:00',
  dryRun: boolean = true
): Promise<ScheduleMaintenanceResult> {
  const alreadyExists = taskExists(TASK_NAME);

  const manageHint =
    `View in Task Scheduler: taskschd.msc → Task Scheduler Library → ${TASK_NAME}. ` +
    `Remove: Unregister-ScheduledTask -TaskName '${TASK_NAME}' -Confirm:$false`;

  if (dryRun) {
    return {
      dry_run: true,
      task_name: TASK_NAME,
      scheduled_time: time,
      action: 'clean_temp',
      action_description: 'Delete %TEMP% contents and empty Recycle Bin',
      task_exists_already: alreadyExists,
      result: 'dry_run',
      manage_hint: manageHint,
      summary: `Dry run: Would ${alreadyExists ? 'update' : 'create'} task "${TASK_NAME}" to run daily at ${time}. Run with dry_run=false to apply.`,
    };
  }

  if (alreadyExists) {
    // Re-register with -Force to update time
    try {
      registerTask(TASK_NAME, time);
      return {
        dry_run: false,
        task_name: TASK_NAME,
        scheduled_time: time,
        action: 'clean_temp',
        action_description: 'Delete %TEMP% contents and empty Recycle Bin',
        task_exists_already: true,
        result: 'registered',
        manage_hint: manageHint,
        summary: `Updated existing maintenance task "${TASK_NAME}" to run daily at ${time}.`,
      };
    } catch (err: any) {
      return {
        dry_run: false,
        task_name: TASK_NAME,
        scheduled_time: time,
        action: 'clean_temp',
        action_description: 'Delete %TEMP% contents and empty Recycle Bin',
        task_exists_already: true,
        result: 'error',
        manage_hint: manageHint,
        summary: `Failed to update task: ${err.message ?? err}`,
      };
    }
  }

  try {
    registerTask(TASK_NAME, time);
    return {
      dry_run: false,
      task_name: TASK_NAME,
      scheduled_time: time,
      action: 'clean_temp',
      action_description: 'Delete %TEMP% contents and empty Recycle Bin',
      task_exists_already: false,
      result: 'registered',
      manage_hint: manageHint,
      summary: `Scheduled maintenance task "${TASK_NAME}" created — runs daily at ${time}. Action: delete %TEMP% and empty Recycle Bin.`,
    };
  } catch (err: any) {
    return {
      dry_run: false,
      task_name: TASK_NAME,
      scheduled_time: time,
      action: 'clean_temp',
      action_description: 'Delete %TEMP% contents and empty Recycle Bin',
      task_exists_already: false,
      result: 'error',
      manage_hint: manageHint,
      summary: `Failed to register task: ${err.message ?? err}`,
    };
  }
}
