import { doctorPuppetmaster } from '../src/runtime/doctor.ts'

const report = doctorPuppetmaster()
console.log(JSON.stringify(report, null, 2))
if (report.liveInstance === 'warn' && report.liveInstanceNote) {
  console.error(`WARN live-instance: ${report.liveInstanceNote}`)
}
if (!report.ok) process.exit(1)
