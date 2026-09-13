#!/usr/bin/env bun
/**
 * Sample live Automaton idle CPU. Soft-skips when no GUI process (CI-safe exit 0).
 * Manual proof: bun run app → wait for settle → bun scripts/sample-idle-cpu.ts
 */
import {
  IDLE_CPU_PACED_BASELINE_PCT,
  IDLE_CPU_WARN_PCT,
  doctorIdleCpu,
  idleParkInventory,
  sampleAutomatonCpu,
} from '../src/runtime/idle-health'

const samples = Number.parseInt(process.env.IDLE_CPU_SAMPLES ?? '8', 10)
const intervalMs = Number.parseInt(process.env.IDLE_CPU_INTERVAL_MS ?? '1000', 10)

const sample = sampleAutomatonCpu({ samples, intervalMs })
if (!sample) {
  console.log(
    JSON.stringify(
      {
        status: 'skip',
        note: 'no live Automaton process — open with `bun run app` first',
        parks: idleParkInventory().map((p) => p.id),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const report = doctorIdleCpu({
  sampleLive: true,
  sample: () => sample,
})

console.log(
  JSON.stringify(
    {
      status: report.status,
      note: report.note,
      meanPct: Math.round(sample.meanPct * 10) / 10,
      samples: sample.samples,
      pid: sample.pid,
      etime: sample.etime,
      cputime: sample.cputime,
      pacedBaselinePct: IDLE_CPU_PACED_BASELINE_PCT,
      warnPct: IDLE_CPU_WARN_PCT,
      parks: idleParkInventory().map((p) => ({ id: p.id, path: p.path })),
    },
    null,
    2,
  ),
)

if (report.status === 'warn') {
  console.error(`WARN idle-cpu: ${report.note}`)
  process.exit(0) // soft-fail: never red CI; WARN is for humans
}
