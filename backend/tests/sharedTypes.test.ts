import fs from 'node:fs';
import path from 'node:path';

// The frontend keeps its own copy of the message types. This fails when the two drift apart.
it('frontend/src/types.ts is a copy of backend/src/types.ts', () => {
  const backend = fs.readFileSync(path.join(__dirname, '../src/types.ts'), 'utf8');
  const frontendFile = path.join(__dirname, '../../frontend/src/types.ts');
  if (!fs.existsSync(frontendFile)) return; // backend deployed on its own
  expect(fs.readFileSync(frontendFile, 'utf8')).toBe(backend);
});
