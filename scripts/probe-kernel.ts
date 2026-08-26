import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JobHandle } from '../src/domain'
import {
  PRODUCT_ROOT,
  analysisInstruction,
  analyzeCwd,
  analyzePrompt,
  buildAnalyzeArgv,
  jobOutcome,
  readArtifactRefs,
  readStatus,
  spawnPm,
  spokenFromArtifactRefs,
  waitForJobId,
  writeAnalyzeConfig,
} from '../src/runtime/pm.ts'

const job: JobHandle = {
  id: `probe_${Date.now()}`,
  ownerAgentId: 'kernel',
  goal: 'One FINDING: Automaton keeps Send as Send while a Kernel job flies. Do not edit files. Do not mention job ids.',
  status: 'running',
  kind: 'analyze',
}

const workerCwd = analyzeCwd(PRODUCT_ROOT)
const instruction = analysisInstruction(analyzePrompt(job))
const files = writeAnalyzeConfig({
  localId: job.id,
  instruction,
  workerCwd,
  timeoutSeconds: 180,
})
const argv = buildAnalyzeArgv({
  ...files,
  label: 'kernel analyze probe',
  timeoutSeconds: 180,
  launchKey: job.id,
})
if (argv.includes('--implement')) throw new Error('probe must not pass --implement')
if (!argv.includes('--goal-file') || !argv.includes('--config')) {
  throw new Error('probe must use run --config --goal-file, the MCP twin')
}

const child = spawnPm(argv, PRODUCT_ROOT)
const spawned = await waitForJobId(child)
const pmJobId = spawned.pmJobId
const attachedAt = new Date().toISOString()

mkdirSync(join(PRODUCT_ROOT, 'artifacts'), { recursive: true })
const probePath = join(PRODUCT_ROOT, 'artifacts', 'pm-probe.json')
writeFileSync(
  probePath,
  JSON.stringify(
    {
      pmJobId,
      workerCwd,
      configPath: files.configPath,
      goalPath: files.goalPath,
      productRoot: PRODUCT_ROOT,
      implement: false,
      attachedAt,
    },
    null,
    2,
  ),
)
console.log(`attached ${pmJobId}`)
console.log(`cwd ${workerCwd}`)

const deadline = Date.now() + 180_000
let snap = readStatus(pmJobId, PRODUCT_ROOT)
while (jobOutcome(snap) === 'running' && Date.now() < deadline) {
  await Bun.sleep(2000)
  try {
    snap = readStatus(pmJobId, PRODUCT_ROOT)
  } catch {
    /* not visible yet */
  }
}

const spoken = spokenFromArtifactRefs(readArtifactRefs(pmJobId, PRODUCT_ROOT))
const report = {
  pmJobId,
  workerCwd,
  configPath: files.configPath,
  goalPath: files.goalPath,
  productRoot: PRODUCT_ROOT,
  implement: false,
  attachedAt,
  status: snap.job?.status ?? 'unknown',
  spoken,
}
writeFileSync(probePath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (!pmJobId.startsWith('job_')) process.exit(1)
if (report.status !== 'complete') process.exit(2)
