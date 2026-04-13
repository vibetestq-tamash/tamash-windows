import { getSystemHealth } from './src/tools/get_system_health';
import { getTopProcesses } from './src/tools/get_top_processes';
import { analyzeSlowdown } from './src/tools/analyze_slowdown';
import { cleanTempFiles } from './src/tools/clean_temp_files';
import { optimizeForMeeting } from './src/tools/optimize_for_meeting';
import { restoreAfterMeeting } from './src/tools/restore_after_meeting';
import { getNetworkHealth } from './src/tools/get_network_health';
import { getStartupItems } from './src/tools/get_startup_items';
import { suggestRestarts } from './src/tools/suggest_restarts';
import { killProcess } from './src/tools/kill_process';
import { disableStartupItem } from './src/tools/disable_startup_item';
import { getBatteryHealth } from './src/tools/get_battery_health';
import { getWindowsUpdateStatus } from './src/tools/get_windows_update_status';
import { getEventLogErrors } from './src/tools/get_event_log_errors';
import { setDisplayScaling } from './src/tools/set_display_scaling';
import { scheduleMaintenance } from './src/tools/schedule_maintenance';

const SEP = '─'.repeat(60);

async function run() {
  console.log(`\n${SEP}`);
  console.log('TOOL 1: get_system_health');
  console.log(SEP);
  try {
    const r = await getSystemHealth();
    console.log(`Status : ${r.overall_status.toUpperCase()}`);
    console.log(`CPU    : ${r.cpu.usage_percent}% (${r.cpu.logical_cores} cores) [${r.cpu.status}]`);
    console.log(`RAM    : ${r.memory.used_gb} / ${r.memory.total_gb} GB (${r.memory.usage_percent}%) [${r.memory.status}]`);
    r.disk.forEach(d => console.log(`Disk ${d.drive}: ${d.free_gb} GB free / ${d.total_gb} GB [${d.status}]`));
    console.log(`Uptime : ${r.uptime.human_readable}`);
    console.log(`Summary: ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 2: get_top_processes (cpu, top 5)');
  console.log(SEP);
  try {
    const r = await getTopProcesses('cpu', 5);
    r.processes.forEach(p =>
      console.log(`  ${p.rank}. ${p.name.padEnd(28)} x${p.instance_count}  CPU: ${String(p.total_cpu_seconds).padStart(8)}s   RAM: ${p.total_memory_mb} MB`)
    );
    console.log(`Total: ${r.total_shown_cpu_seconds}s CPU | ${r.total_shown_memory_mb} MB RAM`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 3: get_top_processes (memory, top 5)');
  console.log(SEP);
  try {
    const r = await getTopProcesses('memory', 5);
    r.processes.forEach(p =>
      console.log(`  ${p.rank}. ${p.name.padEnd(28)} x${p.instance_count}  RAM: ${p.total_memory_mb} MB`)
    );
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 4: analyze_slowdown');
  console.log(SEP);
  try {
    const r = await analyzeSlowdown();
    console.log(`Verdict: ${r.overall_verdict}`);
    console.log(`Recoverable RAM (allowlisted only): ~${r.estimated_recoverable_ram_mb} MB`);
    if (r.findings.length === 0) {
      console.log('No issues found.');
    } else {
      r.findings.forEach(f => {
        console.log(`\n  [${f.severity.toUpperCase()}] ${f.category}`);
        console.log(`  ${f.description}`);
        if (f.culprits.length) console.log(`  Culprits: ${f.culprits.join(', ')}`);
        console.log(`  Fix: ${f.recommended_action}`);
      });
    }
    if (r.quick_wins.length) {
      console.log('\nQuick wins:');
      r.quick_wins.forEach(w => console.log(`  • ${w}`));
    }
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 5: clean_temp_files (dry_run=true, max_age_days=7)');
  console.log(SEP);
  try {
    const r = await cleanTempFiles(true, 7);
    console.log(`Dry run      : ${r.dry_run}`);
    console.log(`Dirs scanned : ${r.directories_scanned}`);
    console.log(`Files found  : ${r.files_found}`);
    console.log(`Would delete : ${r.files_deleted} file(s)`);
    console.log(`Locked/skip  : ${r.files_locked_skipped} file(s) — in use by another process`);
    console.log(`Would free   : ${r.space_freed_mb} MB`);
    console.log(`Summary      : ${r.summary}`);
    if (r.errors.length) console.log(`Errors: ${r.errors.join(', ')}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 6: optimize_for_meeting (dry_run=true)');
  console.log(SEP);
  try {
    const r = await optimizeForMeeting(true, 5);
    console.log(`Summary: ${r.summary}`);
    r.actions_taken.forEach(a => console.log(`  ✓ ${a.target}`));
    r.actions_skipped.filter(a => a.reason !== 'Not currently running').forEach(a =>
      console.log(`  – ${a.target}: ${a.reason}`)
    );
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 7: restore_after_meeting');
  console.log(SEP);
  try {
    const r = await restoreAfterMeeting();
    console.log(`Summary: ${r.summary}`);
    r.actions_taken.forEach(a => console.log(`  ✓ [${a.status}] ${a.target}`));
    r.actions_skipped.forEach(a => console.log(`  – ${a.target}: ${a.reason}`));
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 8: get_network_health');
  console.log(SEP);
  try {
    const r = await getNetworkHealth();
    console.log(`Status : ${r.overall_status.toUpperCase()}`);
    r.latency.forEach(l => console.log(`  ${l.host}: ${l.latency_ms ?? 'timeout'} ms [${l.status}]`));
    console.log(`Active TCP connections: ${r.active_connections}`);
    r.adapters.forEach(a => console.log(`  Adapter: ${a.name} [${a.status}]`));
    console.log(`Summary: ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 9: get_startup_items');
  console.log(SEP);
  try {
    const r = await getStartupItems();
    console.log(`Total: ${r.total_count} | Heavy: ${r.heavy_count}`);
    console.log(`Summary: ${r.summary}`);
    r.items.filter(i => i.is_heavy).forEach(i =>
      console.log(`  ⚠ ${i.name} [${i.location}]`)
    );
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 10: suggest_restarts');
  console.log(SEP);
  try {
    const r = await suggestRestarts();
    console.log(`Total potential savings: ~${r.total_potential_savings_mb} MB`);
    console.log(`Summary: ${r.summary}`);
    r.suggestions.forEach(s => {
      console.log(`\n  [${s.severity.toUpperCase()}] ${s.app}  x${s.instance_count}  running ${s.oldest_running_hours}h`);
      console.log(`  Now: ${s.current_memory_mb} MB → After restart: ~${s.estimated_clean_memory_mb} MB → Save: ~${s.estimated_savings_mb} MB`);
      console.log(`  ${s.reason}`);
      console.log(`  → ${s.suggested_action}`);
    });
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 11: kill_process (dry safe test — process not in allowlist)');
  console.log(SEP);
  try {
    const r = await killProcess('nonexistent_safe_test.exe');
    console.log(`Target   : ${r.target_name}`);
    console.log(`Found    : ${r.instances_found}`);
    console.log(`Killed   : ${r.instances_killed}`);
    console.log(`Skipped  : ${r.instances_skipped}`);
    console.log(`Summary  : ${r.summary}`);
    if (r.errors.length) console.log(`Errors   : ${r.errors.join(', ')}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 12: disable_startup_item (dry_run=true, nonexistent item)');
  console.log(SEP);
  try {
    const r = await disableStartupItem('__test_item_that_does_not_exist__', true);
    console.log(`Found    : ${r.found}`);
    console.log(`Action   : ${r.action_taken}`);
    console.log(`Summary  : ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 13: get_battery_health');
  console.log(SEP);
  try {
    const r = await getBatteryHealth();
    console.log(`Present  : ${r.present}`);
    if (r.present) {
      console.log(`Status   : ${r.status}`);
      console.log(`Charge   : ${r.charge_percent}%`);
      console.log(`Health   : ${r.health_percent ?? 'N/A'}% (${r.wear_level})`);
      console.log(`Cycles   : ${r.cycle_count ?? 'N/A'}`);
      if (r.estimated_hours_remaining !== null)
        console.log(`Remaining: ~${r.estimated_hours_remaining}h`);
    }
    console.log(`Summary  : ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 14: get_windows_update_status');
  console.log(SEP);
  try {
    const r = await getWindowsUpdateStatus();
    console.log(`Pending  : ${r.pending_count} (${r.security_count} security)`);
    console.log(`WU svc   : ${r.wu_service_status}`);
    console.log(`AutoUpdate: ${r.auto_update_enabled}`);
    console.log(`Summary  : ${r.summary}`);
    r.updates.slice(0, 3).forEach(u =>
      console.log(`  ${u.is_security ? '⚠' : '•'} ${u.title.slice(0, 70)} [${u.size_mb ?? '?'} MB]`)
    );
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 15: get_event_log_errors (last 6h, top 10)');
  console.log(SEP);
  try {
    const r = await getEventLogErrors(6, 10);
    console.log(`Found    : ${r.total_found} (${r.critical_count} critical, ${r.error_count} errors, ${r.warning_count} warnings)`);
    console.log(`Summary  : ${r.summary}`);
    r.top_sources.slice(0, 5).forEach(s =>
      console.log(`  ${s.highest_level.padEnd(10)} x${s.count}  ${s.source}`)
    );
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 16: set_display_scaling (dry_run=true, 125%)');
  console.log(SEP);
  try {
    const r = await setDisplayScaling(125, true);
    console.log(`Current  : ${r.current_scaling_percent ?? '?'}%  (DPI ${r.current_dpi ?? '?'})`);
    console.log(`Target   : ${r.requested_scaling_percent}%  (DPI ${r.target_dpi})`);
    console.log(`Action   : ${r.action_taken}`);
    console.log(`Summary  : ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('TOOL 17: schedule_maintenance (dry_run=true, 03:00)');
  console.log(SEP);
  try {
    const r = await scheduleMaintenance('03:00', true);
    console.log(`Task     : ${r.task_name}`);
    console.log(`Time     : ${r.scheduled_time}`);
    console.log(`Exists   : ${r.task_exists_already}`);
    console.log(`Result   : ${r.result}`);
    console.log(`Summary  : ${r.summary}`);
  } catch (e) { console.error('FAILED:', e); }

  console.log(`\n${SEP}`);
  console.log('All tools tested.');
  console.log(SEP);
}

run();
