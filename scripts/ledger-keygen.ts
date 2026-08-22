/**
 * Generate an Ed25519 keypair for signing ledger entries.
 *
 *   npx tsx scripts/ledger-keygen.ts
 *
 * Prints the private key for .env.local and the public key to publish. The
 * private key is printed to stdout and never written to disk by this script,
 * so it cannot be committed by accident - paste it into .env.local (already
 * gitignored) yourself.
 *
 * Ed25519 rather than RSA or ECDSA: 64-byte signatures, no parameter choices
 * to get wrong, and deterministic - the same message always produces the same
 * signature, so a verifier reproducing our work gets byte-identical output.
 */

import crypto from 'crypto'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')

const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')

console.log(`
Ed25519 keypair for the DrishtiAI custody ledger.

Add this to .env.local (gitignored). It is server-only - never prefix it with
NEXT_PUBLIC_, or it will be bundled into the browser JS and anyone can forge
ledger signatures:

LEDGER_SIGNING_KEY=${priv}

Public key, safe to publish. It is also stored on every entry this key signs,
so verifiers do not need it from you - this copy is for your records:

${pub}

If the private key ever leaks, generate a new one and keep using the ledger.
Entries signed by the old key stay verifiable, because each entry carries the
public key it was signed with. Do not try to re-sign old entries: the ledger is
append-only, and rewriting history is the exact thing it exists to prevent.
`)
