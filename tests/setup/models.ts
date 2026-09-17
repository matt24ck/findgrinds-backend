/**
 * Register every Sequelize model with the shared instance, including the ones
 * not re-exported from src/models/index.ts (GardaVetting, TutorSubscription).
 * Both the global schema sync and the per-test truncate need the full set.
 */
import fs from 'fs';
import path from 'path';

const modelsDir = path.join(__dirname, '..', '..', 'src', 'models');
for (const file of fs.readdirSync(modelsDir)) {
  if (/\.(ts|js)$/.test(file) && !file.endsWith('.d.ts')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(path.join(modelsDir, file));
  }
}
