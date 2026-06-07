const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync, writeFileSync, existsSync } = fs;
const { execFileSync, spawn } = require('node:child_process');

function run(cmd, args, cwd, opts = {}) {
  return execFileSync(cmd, args, {
    cwd,
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: opts.capture ? 'utf8' : undefined
  });
}

function assertExists(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected file not found: ${filePath}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), 'context-compass-smoke-'));
  const cliPath = path.resolve(process.cwd(), 'dist', 'cli.js');

  writeFileSync(
    path.join(repoDir, 'app.py'),
    [
      'def greet(name: str) -> str:',
      '    return f"Hello {name}"',
      '',
      'def run() -> None:',
      '    print(greet("World"))',
      ''
    ].join('\n'),
    'utf8'
  );

  run('git', ['init'], repoDir);
  run('git', ['add', 'app.py'], repoDir);
  run('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.com', 'commit', '-m', 'init'], repoDir);

  run(process.execPath, [cliPath, 'init'], repoDir, { capture: true });

  assertExists(path.join(repoDir, '.mcp.json'));
  assertExists(path.join(repoDir, '.claude', 'settings.local.json'));
  assertExists(path.join(repoDir, '.claude', 'skills', 'context-compass-explore', 'SKILL.md'));
  assertExists(path.join(repoDir, '.claude', 'skills', 'context-compass-review', 'SKILL.md'));

  const evalOut = run(process.execPath, [cliPath, 'eval', '--json'], repoDir, { capture: true });
  const parsed = JSON.parse(evalOut);
  const required = [
    'repo',
    'functions',
    'connections',
    'test_sessions',
    'same_file_recall_at_10',
    'context_compass_recall_at_10',
    'same_file_tokens',
    'context_compass_tokens'
  ];
  for (const key of required) {
    if (!(key in parsed)) {
      throw new Error(`eval --json missing key: ${key}`);
    }
  }

  const serve = spawn(process.execPath, [cliPath, 'serve'], {
    cwd: repoDir,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  await sleep(1200);
  if (serve.exitCode !== null) {
    throw new Error('serve exited unexpectedly during smoke test');
  }

  serve.kill();
  await sleep(300);
  console.log('Smoke test passed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
