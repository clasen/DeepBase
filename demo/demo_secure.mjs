import DeepBase from '../index.js';
import CryptoJS from 'crypto-js';

class DeepbaseSecure extends DeepBase {
    constructor(opts) {
        opts.stringify = (obj) => {
            const iv = CryptoJS.lib.WordArray.random(128 / 8);
            const encrypted = CryptoJS.AES.encrypt(JSON.stringify(obj), opts.encryptionKey, { iv });
            return iv.toString(CryptoJS.enc.Hex) + ':' + encrypted.toString();
        };

        opts.parse = (encryptedData) => {
            const [ivHex, encrypted] = encryptedData.split(':');
            const iv = CryptoJS.enc.Hex.parse(ivHex);
            const bytes = CryptoJS.AES.decrypt(encrypted, opts.encryptionKey, { iv });
            return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
        };

        super(opts);
    }
}
// Create a new DeepBase instance with custom serializer and deserializer
const BDS = new DeepbaseSecure({
    name: "demo_secure",
    path: new URL('.', import.meta.url).pathname,
    encryptionKey: 'secret'
});

// Reset the custom database
BDS.del();

// Set some data
const path = await BDS.set("user", "name", "anya");
BDS.set(...path, "user", "age", 1);

// Retrieve and log the data
const retrievedData = BDS.get(...path);
console.log("Retrieved data:", retrievedData);
