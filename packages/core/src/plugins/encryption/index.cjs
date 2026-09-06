const encryption = require('./index.js');

module.exports = encryption.default;
module.exports.encryptedValues = encryption.encryptedValues;
module.exports.EncryptionPlugin = encryption.EncryptionPlugin;
module.exports.DeepBaseEncryptionError = encryption.DeepBaseEncryptionError;
