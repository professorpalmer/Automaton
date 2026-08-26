import { doctorPuppetmaster } from '../src/runtime/doctor.ts'

const report = doctorPuppetmaster()
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(1)
