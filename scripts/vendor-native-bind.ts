/**
 * Bun file: tarballs drop the 22MB `.node` on extract. Overlay the Wave 3.2
 * spring-bearing darwin binary from vendor/ after install.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const src = join(root, 'vendor', 'gpuix-native.darwin-arm64.node')
const destDir = join(root, 'node_modules', '@gpuix', 'native')
const dest = join(destDir, 'gpuix-native.darwin-arm64.node')

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  process.exit(0)
}
if (!existsSync(src)) {
  console.warn('[vendor-native-bind] missing', src)
  process.exit(0)
}
if (!existsSync(destDir)) {
  console.warn('[vendor-native-bind] @gpuix/native not installed yet')
  process.exit(0)
}
copyFileSync(src, dest)
console.log('[vendor-native-bind] wrote', dest)
