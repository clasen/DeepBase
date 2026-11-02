# deepbase/plugins/encryption

Whole-document encryption included in DeepBase. The plugin keeps the database
as a single AES-256-GCM ciphertext under one `$deepbase` key, so drivers never
receive values, object keys, or array lengths in plaintext.

## Installation

```bash
npm install deepbase
```

## Usage

```javascript
import DeepBase from 'deepbase';
import { encryptedDocument } from 'deepbase/plugins/encryption';

const db = new DeepBase({ path: '/var/lib/myapp', name: 'secure' })
  .use(encryptedDocument({ password }));

await db.set('config', 'token', 'secret');
const token = await db.get('config', 'token'); // Decrypted value
```

Pass either a password or a keyring:

```javascript
// scrypt with N=2^17, r=8, p=1 (default)
encryptedDocument({ password });

// stronger scrypt parameters
encryptedDocument({ password, kdf: { N: 2 ** 18 } });

// raw 32-byte keys, identified by keyId
encryptedDocument({
  activeKeyId: '2026-09',
  keys: {
    '2026-09': activeKey,
    '2026-06': previousKey
  }
});
```

The plugin never reads an environment variable or supplies a fallback key.
This entry point requires Node.js (`node:crypto`). It is not loaded when
importing the core or links plugin. CommonJS is also supported:

```javascript
const { encryptedDocument } = require('deepbase/plugins/encryption');
```

## Stored format

With `JsonDriver`, the file and the driver's memory cache hold only this:

```json
{
    "$deepbase": {
        "plugin": "encryption",
        "version": 2,
        "algorithm": "A256GCM",
        "kdf": { "name": "scrypt", "N": 131072, "r": 8, "p": 1, "salt": "…" },
        "iv": "…",
        "tag": "…",
        "ciphertext": "…"
    }
}
```

`ciphertext` is the whole document serialized as JSON. `plugin`, `version`,
`algorithm`, and every `kdf` field are authenticated as GCM additional data. A
keyring stores `"kdf": { "name": "raw", "keyId": "2026-09" }` instead.

## Keys

**Passwords** (string or `Uint8Array`) are copied and stretched with scrypt.
`N` must be a power of two of at least 2^14, `p` at most 16, and `128 * N * r`
at most 256 MiB. The same bounds apply to stored headers, so a forged header
cannot exhaust memory before authentication fails.

The key is derived once per salt and cached, so writes only run AES-GCM with a
fresh IV. Derivation runs asynchronously when the first operation is a read,
and synchronously when it is a write or `getSync()`.

Writes keep the stored parameters while they are at least as strong as the
configured ones (`N`, `r`, and `p` each greater or equal). Otherwise the next
write re-encrypts the document with the configured parameters and a fresh salt.
Raising `kdf` therefore upgrades existing databases, and lowering it never
downgrades them.

**Keyrings** take 32-byte `Buffer` or `Uint8Array` keys. Reads accept every
configured `keyId`, and every write re-encrypts the document with
`activeKeyId`. To rotate, open the database with the new active key and the
previous key, then write once.

## Operations

`get()`, `getSync()`, `set()`, `del()`, `upd()`, `inc()`, `dec()`, `add()`,
`first()`, `last()`, `pop()`, `shift()`, `keys()`, `values()`, `entries()`,
`len()`, and `query()` run over the decrypted document. `upd()` callbacks
receive plaintext.

Each read decrypts and parses the whole document, and each write re-encrypts
it, so cost grows with the document size. Every write is a single driver
`upd()` of the `$deepbase` key, which is atomic in drivers that serialize
`upd()` (the JSON driver's queue, SQLite transactions).

`migrate()`, `syncAll()`, and direct driver access copy or expose the raw
envelope.

## Failures

Errors are `DeepBaseEncryptionError` instances with a `code`, the operation
`path`, and the `keyId` when one applies. They never include plaintext.

| Code | Cause |
| --- | --- |
| `ENCRYPTION_AUTHENTICATION_FAILED` | Wrong password or key, or any change to the ciphertext, tag, IV, or header |
| `ENCRYPTION_MALFORMED_DOCUMENT` | Unknown envelope version or fields, out-of-bounds KDF parameters, or storage holding data beside `$deepbase` |
| `ENCRYPTION_UNKNOWN_KEY` | The envelope needs a `keyId` that is not configured, or a password when a keyring is configured (and vice versa) |
| `ENCRYPTION_DOCUMENT_MISSING` | The stored document disappeared after this instance read or wrote it |
| `ENCRYPTION_SERIALIZATION_FAILED` | The updated document cannot be serialized as JSON |
| `ENCRYPTION_OPERATION_UNSUPPORTED` | An operation the plugin does not implement |
| `ENCRYPTION_PLUGIN_DISPOSED` | The plugin was disposed |

Writes decrypt the stored document first, so a wrong password or a tampered
document is never overwritten.

## Limits

- Replacing the whole envelope with an older one, or with another database's
  encrypted with the same password or key, is not detected.
- The ciphertext length reveals the approximate document size.
- A database without a stored document opens as empty. Within one instance,
  a document that disappears after being read fails with
  `ENCRYPTION_DOCUMENT_MISSING`.
- Plaintext exists while an operation runs and in the values your application
  reads. JavaScript strings cannot be zeroed; disposal zeroes the password, the
  raw keys, and every derived key.
- Existing plaintext data is not migrated. Read it with a plain `DeepBase` and
  write it into a new encrypted one.
