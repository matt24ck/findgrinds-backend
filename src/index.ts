import dotenv from 'dotenv';
dotenv.config();

import { connectDatabase, syncDatabase } from './config/database';
import { assertJwtSecretConfigured } from './config/jwt';
import { createApp } from './app';
import { startGroupSessionScheduler } from './services/groupSessionScheduler';
import { screeningService } from './services/screeningService';

const PORT = process.env.PORT || 3001;

// Start server
async function startServer() {
  try {
    // Fail fast on unsafe config before accepting traffic.
    assertJwtSecretConfigured();

    await connectDatabase();
    await syncDatabase();

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(
        `Message screening: ${screeningService.isEnabled() ? `enabled (${process.env.SCREENING_SERVICE_URL})` : 'DISABLED (set SCREENING_SERVICE_URL)'}`
      );
      startGroupSessionScheduler();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
