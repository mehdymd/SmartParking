const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const frontendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendDir, '..');
const reactScriptsBin = require.resolve('react-scripts/bin/react-scripts.js');
const pythonCmd = process.env.PYTHON || 'python3';
const shellCmd = process.env.SHELL || '/bin/zsh';
const backendCommand = `${pythonCmd} -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`;

let backendProcess = null;
let frontendProcess = null;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkBackend() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: '127.0.0.1',
        port: 8000,
        path: '/parking/camera-status',
        timeout: 1000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode >= 200 && response.statusCode < 500);
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkBackend()) {
      return true;
    }
    if (backendProcess && backendProcess.exitCode !== null) {
      return false;
    }
    await wait(1000);
  }
  return false;
}

function stopChildren(signal = 'SIGTERM') {
  if (frontendProcess && frontendProcess.exitCode === null) {
    frontendProcess.kill(signal);
  }
  if (backendProcess && backendProcess.exitCode === null) {
    backendProcess.kill(signal);
  }
}

function wireSignals() {
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      stopChildren(signal);
      process.exit(0);
    });
  });
}

function startFrontend() {
  frontendProcess = spawn(process.execPath, [reactScriptsBin, 'start'], {
    cwd: frontendDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, '--no-deprecation'].filter(Boolean).join(' '),
    },
  });

  frontendProcess.on('exit', (code) => {
    if (backendProcess && backendProcess.exitCode === null) {
      backendProcess.kill('SIGTERM');
    }
    process.exit(code ?? 0);
  });
}

async function main() {
  wireSignals();

  const backendRunning = await checkBackend();
  if (!backendRunning) {
    console.log('Starting backend on http://127.0.0.1:8000');
    backendProcess = spawn(shellCmd, ['-lc', backendCommand], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });

    backendProcess.on('exit', (code) => {
      if (!frontendProcess) {
        process.exit(code ?? 1);
      }
    });

    const ready = await waitForBackend();
    if (!ready) {
      console.error('Backend did not become ready on port 8000.');
      stopChildren();
      process.exit(1);
    }
  } else {
    console.log('Using existing backend on http://127.0.0.1:8000');
  }

  startFrontend();
}

main().catch((error) => {
  console.error(error);
  stopChildren();
  process.exit(1);
});
