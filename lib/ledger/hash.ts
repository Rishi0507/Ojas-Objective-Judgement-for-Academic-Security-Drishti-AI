import crypto from 'crypto'
import fs from 'fs'

/**
 * Hashing primitives for the custody ledger.
 *
 * Everything here has to be reproducible years later, by a verifier that may
 * not be this codebase - possibly the Go backend, possibly a script someone
 * writes to check our claims. That constraint rules out anything convenient
 * but ambiguous, which is why serialisation below is strict to the point of
 * refusing input rather than guessing.
 */

export const ZERO_HASH = '0'.repeat(64)

/** Hash of a UTF-8 string, lowercase hex. */
export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Hash a file by streaming it.
 *
 * Uploads are capped at 2GB, so reading one into a Buffer to hash it would
 * mean a multi-gigabyte allocation per upload and an out-of-memory crash
 * under any real concurrency. The stream holds one chunk at a time.
 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Deterministic JSON: object keys sorted, no insignificant whitespace.
 *
 * `JSON.stringify` preserves insertion order, so two objects that are equal in
 * every way a program cares about serialise differently and hash differently
 * depending on the order fields happened to be assigned. That produces a
 * ledger which fails verification for no reason a human can see, and it is the
 * single most common way hash chains break in practice.
 *
 * Inputs that cannot round-trip are rejected rather than silently coerced:
 *
 *   - `undefined` is dropped by JSON.stringify inside objects but becomes
 *     `null` inside arrays, so the same value hashes two different ways
 *     depending on where it sits.
 *   - `NaN` and `Infinity` both serialise to `null`, collapsing distinct
 *     values into one digest.
 *   - Numbers beyond Number.MAX_SAFE_INTEGER have already lost precision by
 *     the time they arrive, so the digest would attest to the wrong value.
 *
 * Rejecting is right here even though it is unfriendly: a ledger that quietly
 * hashes something other than what it was given is worse than one that fails
 * loudly at the point of the mistake.
 */
export function canonicalJSON(value: unknown, path = '$'): string {
  if (value === null) return 'null'

  const t = typeof value
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'string') return JSON.stringify(value)

  if (t === 'number') {
    const n = value as number
    if (!Number.isFinite(n)) {
      throw new Error(`canonicalJSON: non-finite number at ${path} cannot be hashed reproducibly`)
    }
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
      throw new Error(`canonicalJSON: integer at ${path} exceeds safe range and has lost precision`)
    }
    return JSON.stringify(n)
  }

  if (t === 'undefined') {
    throw new Error(`canonicalJSON: undefined at ${path}; use null to record an absent value`)
  }

  if (Array.isArray(value)) {
    return '[' + value.map((v, i) => canonicalJSON(v, `${path}[${i}]`)).join(',') + ']'
  }

  if (t === 'object') {
    // Date and friends stringify to something reasonable but their `toJSON`
    // is not part of any contract we control; make the caller convert first.
    if (!isPlainObject(value)) {
      throw new Error(`canonicalJSON: unsupported object at ${path}; pass plain data only`)
    }
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return (
      '{' +
      keys
        .map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k], `${path}.${k}`)}`)
        .join(',') +
      '}'
    )
  }

  throw new Error(`canonicalJSON: cannot hash ${t} at ${path}`)
}

function isPlainObject(v: unknown): boolean {
  if (Object.prototype.toString.call(v) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(v)
  return proto === null || proto === Object.prototype
}

/** Hash of a document, via its canonical form. */
export function hashDocument(doc: unknown): string {
  return sha256(canonicalJSON(doc))
}

/**
 * Join fields length-prefixed before hashing.
 *
 * Concatenating "ab" + "c" and "a" + "bc" gives the same string and therefore
 * the same digest, which would let two different entries claim one hash.
 * Prefixing each field with its length removes the ambiguity.
 *
 * Mirrored byte-for-byte by ledger_append() in 0002_ledger.sql. Changing
 * either without the other silently breaks verification for every entry
 * written afterwards, so the two must be edited together.
 */
export function joinFields(...fields: string[]): string {
  return fields.map((f) => `${f.length}:${f}`).join('|')
}
