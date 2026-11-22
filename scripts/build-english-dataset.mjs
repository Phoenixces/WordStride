import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(root, 'third-party/zxcvbn/english_wikipedia.txt');
const outputDirectory = join(root, 'public/words/en');
const manifestPath = join(root, 'public/words/en-manifest.json');
const expectedSourceHash = 'b29af10c62218f948eb299e0c68b176ab1c5ecdfe9813bd957bf2c434e90813e';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(sourcePath);
const sourceHash = sha256(source);
if (sourceHash !== expectedSourceHash) {
  throw new Error('Source snapshot changed. Review its provenance and update the pinned SHA-256 before regenerating.');
}

const alphabet = 'abcdefghijklmnopqrstuvwxyz';
const raw = source.toString('utf8').split(/\r?\n/).filter(Boolean);
// Deliberately do not invent, stem, translate, or merge entries from other corpora.
const words = [...new Set(raw.map(word => word.trim().toLowerCase()).filter(word => /^[a-z]{2,}$/.test(word)))].sort();
const files = {};
const content = new Map();
for (const letter of alphabet) {
  const entries = words.filter(word => word.startsWith(letter));
  const json = JSON.stringify(entries, null, 2) + '\n';
  content.set(`${letter}.json`, json);
  files[letter] = { path: `words/en/${letter}.json`, count: entries.length, bytes: Buffer.byteLength(json), sha256: sha256(json) };
}
const manifest = {
  schemaVersion: 1,
  id: 'english-zxcvbn-wikipedia',
  version: `zxcvbn-component-3-${sourceHash.slice(0, 12)}`,
  language: 'en',
  kind: 'word-list',
  ordering: 'lexicographical-ascii',
  batchSize: 25,
  count: words.length,
  source: {
    name: 'zxcvbn English Wikipedia frequency list',
    distribution: 'Chromium ZxcvbnData component',
    componentVersion: '3',
    repository: 'https://github.com/dropbox/zxcvbn',
    portRepository: 'https://github.com/rianhunter/zxcvbn-cpp',
    snapshot: 'third-party/zxcvbn/english_wikipedia.txt',
    sha256: sourceHash,
    sourceLines: raw.length,
    license: 'MIT',
    licensePath: 'words/LICENSE-zxcvbn.txt',
  },
  filters: ['Trim surrounding whitespace', 'Lowercase', 'Keep ASCII a-z words of at least two letters', 'Remove duplicates', 'Sort by ASCII lexicographical order'],
  limitations: 'A frequency corpus, not an exhaustive dictionary. Names, abbreviations, specialist terms, and uncommon entries may appear. Definitions and example sentences are not included.',
  files,
};
const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
const publicLicensePath = join(root, 'public/words/LICENSE-zxcvbn.txt');
const license = await readFile(join(root, 'third-party/zxcvbn/LICENSE'), 'utf8');

if (process.argv.includes('--check')) {
  const actualNames = (await readdir(outputDirectory)).filter(name => name.endsWith('.json')).sort();
  const expectedNames = [...content.keys()].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error('Expected exactly 26 letter JSON files.');
  for (const [name, expected] of content) {
    if (await readFile(join(outputDirectory, name), 'utf8') !== expected) throw new Error(`Generated data differs: ${name}`);
  }
  if (await readFile(manifestPath, 'utf8') !== manifestJson) throw new Error('Generated manifest differs.');
  if (await readFile(publicLicensePath, 'utf8') !== license) throw new Error('Published license differs.');
  console.log(`Verified ${words.length.toLocaleString('en-US')} sorted, unique words across 26 files; source and output hashes match.`);
} else {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([...content].map(([name, json]) => writeFile(join(outputDirectory, name), json)));
  await writeFile(manifestPath, manifestJson);
  await writeFile(publicLicensePath, license);
  console.log(`Generated ${words.length.toLocaleString('en-US')} sorted, unique words across 26 files.`);
}
