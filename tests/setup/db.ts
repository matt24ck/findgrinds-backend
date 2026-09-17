/**
 * Per-file database lifecycle (jest `setupFilesAfterEnv`): open the connection,
 * empty every table before each test, close at the end.
 */
import { sequelize } from '../../src/config/database';
import './models';

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true, restartIdentity: true });
  jest.clearAllMocks();
});

afterAll(async () => {
  await sequelize.close();
});
