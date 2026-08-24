/**
 * A `vite preview` server that is reliably torn down.
 *
 * ## Why this exists
 *
 * Every measurement script used to spawn its own server and kill it at the end:
 *
 *     const server = spawn('npx', ['vite', 'preview', ...], { cwd: ROOT, stdio: 'ignore' });
 *     ...
 *     server.kill('SIGTERM');
 *
 * That leaks in two ways, and both were observed.
 *
 * **It never runs on the unhappy path.** A throw between the spawn and the kill, or a
 * Ctrl-C, leaves the server listening for the rest of the session. Four of them
 * accumulated this way (ports 4351, 4353, 4355, 4361) and were still holding CPU when a
 * full-model E2E run was started, which is the environment that produced a 45-minute run
 * of 900-second timeouts.
 *
 * **`SIGTERM` to `npx` need not reach `vite`.** `npx` execs a child; signalling the parent
 * can orphan the actual server. So this spawns into its **own process group**
 * (`detached: true`) and signals the group (`kill(-pid)`), which reaches every descendant.
 *
 * Cleanup is registered once per process and fires on normal exit, on `SIGINT`/`SIGTERM`,
 * and on an uncaught error — so a script that crashes still takes its server with it.
 */

import { spawn } from 'node:child_process';

/** Every group this process has started and not yet reaped. */
const live = new Set();
let hooked = false;

/** Signal one group, tolerating a process that has already gone. */
const signal = (pid, sig) => {
  try {
    process.kill(-pid, sig);
  } catch {
    /* already reaped, or never started */
  }
};

const killAll = () => {
  for (const pid of live) signal(pid, 'SIGTERM');
  live.clear();
};

function hookOnce() {
  if (hooked) return;
  hooked = true;
  // `exit` must stay synchronous — no awaiting, no timers.
  process.on('exit', killAll);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      killAll();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
  for (const event of ['uncaughtException', 'unhandledRejection']) {
    process.on(event, (error) => {
      killAll();
      console.error(`\n${event}:`, error);
      process.exit(1);
    });
  }
}

/**
 * Start `vite preview` and wait until it answers.
 *
 * Returns `{ url, server }`, where `server.kill()` stops the whole group — the same shape
 * the scripts already used, so call sites keep working unchanged.
 */
export async function startPreview({ root, port, attempts = 150, intervalMs = 200 }) {
  hookOnce();

  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
    // Its own process group, so a signal reaches `vite` and not merely `npx`.
    detached: true,
  });
  child.unref();
  live.add(child.pid);

  const stop = () => {
    if (!live.has(child.pid)) return;
    signal(child.pid, 'SIGTERM');
    live.delete(child.pid);
    // A server wedged mid-request ignores SIGTERM; make sure it cannot outlive the run.
    const pid = child.pid;
    setTimeout(() => signal(pid, 'SIGKILL'), 2000).unref?.();
  };

  const url = `http://localhost:${port}`;
  for (let i = 0; i < attempts; i++) {
    try {
      if ((await fetch(url)).ok) return { url, server: { kill: stop }, stop };
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  stop();
  throw new Error(
    `vite preview did not answer on ${url} within ` +
      `${Math.round((attempts * intervalMs) / 1000)}s — is port ${port} already taken?`
  );
}
