import { doctorPuppetmaster } from '../src/runtime/doctor.ts'

const report = doctorPuppetmaster()
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
if (!report.ok) process.exit(1)
