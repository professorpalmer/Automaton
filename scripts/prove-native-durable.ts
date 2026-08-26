import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openStaffStore } from '../src/runtime/store'
import { claimTaskKey } from '../src/runtime/working-set'

const PRODUCT_ROOT = join(import.meta.dir, '..')
const FINDING = 'The ledger replay is deterministic.'

const store = openStaffStore()
store.remember({
  ownerAgentId: 'kernel',
  text: FINDING,
  source: 'job',
  jobId: 'job_native_seed',
  taskKey: claimTaskKey({ ownerAgentId: 'kernel', kind: 'analyze', goal: 'ledger replay' }),
  artifactKind: 'analyze',
  freshness: 'fresh',
})

const ledger = store.metrics()
const dest = join(PRODUCT_ROOT, 'artifacts', 'native-durable-ledger.json')
mkdirSync(join(PRODUCT_ROOT, 'artifacts'), { recursive: true })
writeFileSync(
  dest,
  `${JSON.stringify(
    {
      storePath: store.path,
      seeded: FINDING,
      recall: 'what did Kernel find about ledger replay',
      miss: 'Hello, what is your name?',
      ledger,
      capturedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
)
console.log(
  `ledger turns=${ledger.turns} hits=${ledger.hits} misses=${ledger.misses} avoided=${ledger.inferenceAvoided} calls=${ledger.inferenceCalls}`,
)
