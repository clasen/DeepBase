const encryption = require('./index.js');

module.exports = encryption.default;
module.exports.encryptedDocument = encryption.encryptedDocument;
module.exports.EncryptionPlugin = encryption.EncryptionPlugin;
module.exports.DeepBaseEncryptionError = encryption.DeepBaseEncryptionError;
