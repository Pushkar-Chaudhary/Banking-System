const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function stop(signal, code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  if (signal) console.log(`Stopping the app (${signal})...`);

  for (const child of children.keys()) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
  }
  if (children.size === 0) process.exitCode = exitCode;
}

function start(name, args) {
  if (shuttingDown) return;

  let child;
  try {
    child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  } catch (error) {
    console.error(`Could not start ${name}: ${error.message}`);
    stop(null, 1);
    return;
  }

  children.set(child, name);
  child.on('error', (error) => {
    console.error(`Could not start ${name}: ${error.message}`);
    stop(null, 1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`${name} exited unexpectedly (${signal || `exit code ${code}`}).`);
      stop(null, code || 1);
    }
    if (shuttingDown && children.size === 0) process.exitCode = exitCode;
  });
}

process.on('SIGINT', () => stop('Ctrl+C', 0));
process.on('SIGTERM', () => stop('SIGTERM', 0));

console.log('Starting API and storefront. Open the Local URL printed by Vite.');
start('API', ['--watch', 'server.js']);
start('Storefront', [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '0.0.0.0']);
