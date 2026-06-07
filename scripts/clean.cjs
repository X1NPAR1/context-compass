const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.cwd(), 'dist');
fs.rmSync(target, { recursive: true, force: true });
