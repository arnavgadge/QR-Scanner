// Checks the built desktop app (build/): no Firebase anywhere, and nothing that would make an
// internet request. Run after `npm run build`. Exit code 1 on any finding.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) =>
  readdirSync(d).flatMap((n) =>
    statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)],
  );
const files = walk('build').filter((f) => /\.(js|cjs|html|css)$/.test(f));
const findings = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const bad of [
    '@firebase/',
    'firebaseio.com',
    'googleapis.com',
    'identitytoolkit',
    'gstatic.com',
  ]) {
    if (text.includes(bad)) findings.push(`${bad} in ${f}`);
  }
  // Remote script/style/font/image loads in the page.
  for (const m of text.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/g))
    findings.push(`remote asset ${m[1]} in ${f}`);
  for (const m of text.matchAll(/@import\s+url\(["']?(https?:[^)"']+)/g))
    findings.push(`remote CSS ${m[1]} in ${f}`);
}
if (findings.length) {
  console.error('Desktop bundle check FAILED:\n' + findings.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} built files, no Firebase, no remote assets.`);
