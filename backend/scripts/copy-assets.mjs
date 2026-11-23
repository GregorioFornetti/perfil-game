// Copies the files the TypeScript compiler does not emit (card data and translations) into dist/.
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(root, 'src/cards/data'), join(root, 'dist/cards/data'), { recursive: true });
cpSync(join(root, 'src/locales'), join(root, 'dist/locales'), { recursive: true });
