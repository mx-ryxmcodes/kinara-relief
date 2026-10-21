// Writes db.json from the seed. Run `npm run seed` to reset the demo data.
// Stop the API first (or let json-server --watch reload it).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSeed } from './seed.js';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'db.json');
writeFileSync(target, JSON.stringify(buildSeed(), null, 2) + '\n');
console.log(`Seed written to ${target}`);
