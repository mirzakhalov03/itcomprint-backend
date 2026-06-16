/**
 * Production-entrypoint smoke test: boots the COMPILED server (dist/server.js)
 * against an in-memory MongoDB, checks security headers + DB-aware health,
 * then verifies graceful shutdown on SIGTERM. Run after `npm run build`.
 */
import { spawn } from 'child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function main() {
  const mongo = await MongoMemoryServer.create();
  const proc = spawn('node', ['dist/server.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: '4066', MONGODB_URI: mongo.getUri('roadshow_badges'), CORS_ORIGIN: 'https://kiosk.example' },
    stdio: 'inherit',
  });

  let ok = true;
  const fail = (m: string) => { ok = false; console.log(`  ✗ ${m}`); };
  const pass = (m: string) => console.log(`  ✓ ${m}`);

  try {
    // wait for the server to come up
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch('http://localhost:4066/api/health');
        if (r.status === 200) break;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const health = await fetch('http://localhost:4066/api/health');
    const body = await health.json();
    health.status === 200 && body.ok === true ? pass('health → 200 ok (DB up)') : fail(`health: ${health.status} ${JSON.stringify(body)}`);
    health.headers.get('x-dns-prefetch-control') ? pass('helmet security headers present') : fail('helmet headers missing');
    health.headers.get('x-powered-by') === null ? pass('x-powered-by disabled') : fail('x-powered-by leaked');

    // graceful shutdown
    const exited = new Promise<number>((resolve) => proc.on('exit', (code) => resolve(code ?? -1)));
    proc.kill('SIGTERM');
    const code = await Promise.race([
      exited,
      new Promise<number>((r) => setTimeout(() => r(-99), 12_000)),
    ]);
    code === 0 ? pass('SIGTERM → graceful exit (code 0)') : fail(`shutdown exit code ${code}`);
  } finally {
    if (!proc.killed) proc.kill('SIGKILL');
    await mongo.stop();
  }

  console.log(`\n${ok ? 'SMOKE PASSED' : 'SMOKE FAILED'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
