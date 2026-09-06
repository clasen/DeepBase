# deepbase/plugins/encryption

Authenticated value encryption included in DeepBase. This plugin encrypts every leaf
with AES-256-GCM automatically, preserving the stored tree and keys.

This is not compatible with the SOPS file format or CLI.

## Installation

```bash
npm install deepbase
```

## Usage

```javascript
import DeepBase from 'deepbase';
import { encryptedValues } from 'deepbase/plugins/encryption';

const encryption = encryptedValues({
  activeKeyId: '2026-09',
  keys: {
    '2026-09': activeKey,
    '2026-06': previousKey
  }
});

const db = new DeepBase(driver).use(encryption);

await db.set('config', 'token', 'secret');
const token = await db.get('config', 'token'); // Decrypted value
```

`activeKeyId` and `keys` are required. Every key must be a 32-byte
`Buffer` or `Uint8Array`; the plugin never reads an environment variable or
supplies a fallback key. No path selectors are needed or supported. All values
written through the plugin are encrypted; object keys, array lengths, and empty
containers remain visible so nested paths can still be read and updated.

This entry point requires Node.js (`node:crypto`). It is not loaded when importing
the core or links plugin. CommonJS is also supported:

```javascript
const { encryptedValues } = require('deepbase/plugins/encryption');
```

Stored envelopes contain an algorithm, version, `keyId`, fresh 12-byte IV,
authentication tag, and ciphertext. Reads accept every configured key ID;
writes always use the active key. Authentication failure, malformed envelopes,
unknown keys, and unsupported serialization fail without returning plaintext.

`inc()` and `dec()` are implemented through the driver's
existing `upd()` behavior. `upd()` callbacks receive plaintext and their result
is encrypted before storage.

`getSync()` is supported. `migrate()`, `syncAll()`, and direct driver access
copy or expose raw envelopes. Disposing the DeepBase instance clears the
plugin's internal key copies. Bulk key rotation is not included; rewrite a
value to move it to the active key. Existing plaintext data is not automatically
rewritten; it is encrypted when written through the plugin.
