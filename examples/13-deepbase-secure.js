import CryptoJS from 'crypto-js';
import { DeepBase } from '../packages/core/src/index.js';
import { JsonDriver } from '../packages/driver-json/src/index.js';

class DeepbaseSecure extends DeepBase {
    constructor(opts) {
        const encryptionKey = opts.encryptionKey;
        delete opts.encryptionKey;

        // Create JSON driver with encryption
        const driver = new JsonDriver({
            ...opts,
            stringify: (obj) => {
                const iv = CryptoJS.lib.WordArray.random(128 / 8);
                const encrypted = CryptoJS.AES.encrypt(
                    JSON.stringify(obj),
                    encryptionKey,
                    { iv }
                );
                return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
            },
            parse: (encryptedData) => {
                const [ivHex, encrypted] = encryptedData.split(':');
                const iv = CryptoJS.enc.Hex.parse(ivHex);
                const bytes = CryptoJS.AES.decrypt(encrypted, encryptionKey, { iv });
                return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
            }
        });

        super(driver);
    }
}

// --- Demo ---

const db = new DeepbaseSecure({
    name: 'secure-demo',
    path: './db',
    encryptionKey: 'my-secret-key-123'
});

// Write encrypted data
await db.set('users', 'alice', { name: 'Alice', email: 'alice@example.com', role: 'admin' });
await db.set('users', 'bob', { name: 'Bob', email: 'bob@example.com', role: 'user' });
await db.set('config', 'apiKey', 'sk-super-secret-token');

// Read decrypted data
const alice = await db.get('users', 'alice');
console.log('Alice:', alice);

const allUsers = await db.get('users');
console.log('All users:', allUsers);

const apiKey = await db.get('config', 'apiKey');
console.log('API Key:', apiKey);

// Show that the file on disk is encrypted
import fs from 'fs';
const raw = fs.readFileSync('./db/secure-demo.json', 'utf8');
console.log('\nEncrypted file contents:\n', raw.substring(0, 120) + '...');

await db.disconnect();
