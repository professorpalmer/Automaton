import { doctorPuppetmaster, doctorPuppetmasterAsync } from '../src/runtime/doctor.ts'

const liveCloud = process.env.AUTOMATON_CLOUD_PROBE === '1'
const report = liveCloud ? await doctorPuppetmasterAsync() : doctorPuppetmaster()
console.log(JSON.stringify(report, null, 2))
if (report.liveInstance === 'warn' && report.liveInstanceNote) {
  console.error(`WARN live-instance: ${report.liveInstanceNote}`)
}
if (report.version === 'warn' && report.versionNote) {
  console.error(`WARN version: ${report.versionNote}`)
}
if (report.idleCpu === 'warn' && report.idleCpuNote) {
  console.error(`WARN idle-cpu: ${report.idleCpuNote}`)
} else if (report.idleCpuNote) {
  console.error(`idle-cpu: ${report.idleCpuNote}`)
}
if (report.cloud === 'warn' && report.cloudNote) {
  console.error(`WARN cloud: ${report.cloudNote}`)
} else if (report.cloud === 'parked' && report.cloudNote) {
  console.error(`WARN cloud: ${report.cloudNote}`)
} else if (report.cloudNote) {
  console.error(`cloud: ${report.cloudNote}`)
}
if (report.providers === 'warn' && report.providersNote) {
  console.error(`WARN providers: ${report.providersNote}`)
} else if (report.providersNote) {
  console.error(`providers: ${report.providersNote}`)
}
if (!report.ok) process.exit(1)
