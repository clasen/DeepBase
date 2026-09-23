#!/usr/bin/env node
/**
 * Run test.html in headless Chrome/Chromium without adding npm dependencies.
 *
 * The script serves the repository over HTTP (ES modules and the page import
 * map need http(s)), launches a local Chrome build with the DevTools protocol,
 * waits for the page test runner and reports every test result.
 *
 * Usage: node test/run-headless.js [--port 8791] [--timeout 90000] [--keep-open]
 * Env:   CHROME_PATH=/path/to/chrome
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const pagePath = '/packages/driver-indexeddb/test/test.html';

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
};

function parseArgs(argv) {
  const options = { port: 8791, timeout: 90000, keepOpen: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--timeout') options.timeout = Number(argv[++index]);
    else if (arg === '--keep-open') options.keepOpen = true;
  }
  return options;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ];
  return candidates.find(candidate => fs.existsSync(candidate));
}

function startServer(port) {
  const server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(repoRoot, requested);

    if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function startChrome(executablePath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepbase-chrome-'));
  // chrome-headless-shell is already headless and rejects the flag.
  const headlessFlag = path.basename(executablePath).includes('headless') ? [] : ['--headless=new'];
  const child = spawn(executablePath, [
    ...headlessFlag,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not report a DevTools endpoint:\n${stderr}`)), 30000);

    child.stderr.on('data', chunk => {
      stderr += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (match) {
        clearTimeout(timer);
        resolve({ child, browserUrl: match[1], userDataDir });
      }
    });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}:\n${stderr}`));
    });
  });
}

function connect(browserUrl) {
  const socket = new WebSocket(browserUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('Could not connect to the DevTools endpoint')));
  });

  return {
    ready,
    onMessage(listener) {
      listeners.add(listener);
    },
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() {
      socket.close();
    },
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error('No Chrome/Chromium found. Set CHROME_PATH to a browser binary.');
  }

  const server = await startServer(options.port);
  const chrome = await startChrome(executablePath);
  const client = connect(chrome.browserUrl);
  let exitCode = 0;

  try {
    await client.ready;
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);
    await client.send('Page.navigate', { url: `http://127.0.0.1:${options.port}${pagePath}` }, sessionId);

    const deadline = Date.now() + options.timeout;
    let payload;
    while (Date.now() < deadline) {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `(() => {
          if (typeof testResults === 'undefined') return 'pending';
          const summary = document.querySelector('#summary');
          if (!summary || !summary.textContent.trim()) return 'pending';
          return JSON.stringify({ results: testResults, summary: summary.textContent.replace(/\\s+/g, ' ').trim() });
        })()`,
        returnByValue: true,
      }, sessionId);

      if (result.value && result.value !== 'pending') {
        payload = JSON.parse(result.value);
        break;
      }
      await sleep(250);
    }

    if (!payload) throw new Error(`The page did not finish its tests within ${options.timeout}ms`);

    console.log(payload.summary);
    for (const test of payload.results) {
      console.log(`${test.passed ? 'PASS' : 'FAIL'}: ${test.name}${test.passed ? '' : ` :: ${test.error}`}`);
    }

    const failed = payload.results.filter(test => !test.passed).length;
    console.log(`total=${payload.results.length} ok=${payload.results.length - failed} fallos=${failed}`);
    exitCode = failed === 0 ? 0 : 1;

    if (options.keepOpen) {
      console.log('--keep-open: press Ctrl+C to stop the browser');
      await new Promise(() => {});
    }
  } finally {
    client.close();
    const stopped = new Promise(resolve => chrome.child.once('exit', resolve));
    chrome.child.kill('SIGKILL');
    await Promise.race([stopped, sleep(3000)]);
    server.close();
    try {
      fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // The profile directory is disposable; Chrome may still be releasing files.
    }
  }

  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
