const pathModule = require('node:path');
const { fileURLToPath } = require('node:url');

function resolvePath(moduleUrl, path) {
  const isFileUrl = moduleUrl instanceof URL
    ? moduleUrl.protocol === 'file:'
    : typeof moduleUrl === 'string' && moduleUrl.startsWith('file:');

  if (!isFileUrl) {
    throw new TypeError('resolvePath(): moduleUrl must be a file URL such as import.meta.url.');
  }
  if (typeof path !== 'string' || path.trim() === '') {
    throw new TypeError('resolvePath(): path must be a non-empty string.');
  }

  return pathModule.resolve(pathModule.dirname(fileURLToPath(moduleUrl)), path);
}

module.exports = { resolvePath };
