const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKIP_PREFIXES = [
  'node_modules/',
  'dist/',
  '.git/',
  '.context-compass/',
  'coverage/'
];

const SKIP_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.pdf',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.tgz',
  '.zip',
  '.gz'
]);

const PATTERNS = [
  { name: 'AWS access key', regex: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'OpenAI key', regex: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'Anthropic key assignment', regex: /\bANTHROPIC_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/g },
  { name: 'Private key block', regex: /-----BEGIN (RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/g }
];

function listTrackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

function shouldSkip(filePath) {
  if (SKIP_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  return SKIP_EXTS.has(ext);
}

function readText(filePath) {
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) {
    return null;
  }
  return content.toString('utf8');
}

function scanFile(filePath, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  for (const pattern of PATTERNS) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(line)) {
        findings.push({
          filePath,
          line: i + 1,
          pattern: pattern.name
        });
      }
    }
  }

  return findings;
}

function main() {
  const files = listTrackedFiles();
  const findings = [];

  for (const file of files) {
    if (shouldSkip(file)) {
      continue;
    }
    let text;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    if (text === null) {
      continue;
    }
    findings.push(...scanFile(file, text));
  }

  if (findings.length === 0) {
    process.stdout.write('Secret scan passed\n');
    return;
  }

  process.stderr.write('Potential secrets detected:\n');
  for (const finding of findings) {
    process.stderr.write(`- ${finding.filePath}:${finding.line} (${finding.pattern})\n`);
  }
  process.exit(1);
}

main();
