import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// An opaque checkout marker, not authentication. Never expose the local path.
export function previewIdentity(root: string): string {
  const path = resolve(root)
  return createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex')
}
