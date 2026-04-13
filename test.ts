import { getSystemHealth } from './src/tools/get_system_health';
import { getTopProcesses } from './src/tools/get_top_processes';
import { analyzeSlowdown } from './src/tools/analyze_slowdown';
import { cleanTempFiles } from './src/tools/clean_temp_files';
import { optimizeForMeeting } from './src/tools/optimize_for_meeting';
import { restoreAfterMeeting } from './src/tools/restore_after_meeting';
import { getNetworkHealth } from './src/tools/get_network_health';
import { getStartupItems } from './src/tools/get_startup_items';

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
  console.log('All tools tested.');
  console.log(SEP);
}

run();
