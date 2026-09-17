import express from 'express';
import cors from 'cors';

// Import routes
import authRoutes from './routes/auth';
import tutorRoutes from './routes/tutors';
import sessionRoutes from './routes/sessions';
import resourceRoutes from './routes/resources';
import paymentRoutes from './routes/payments';
import gdprRoutes from './routes/gdpr';
import verificationRoutes from './routes/verification';
import adminRoutes from './routes/admin';
import stripeRoutes from './routes/stripe';
import availabilityRoutes from './routes/availability';
import parentRoutes from './routes/parent';
import uploadRoutes from './routes/upload';
import messageRoutes from './routes/messages';
import aiRoutes from './routes/ai';

/**
 * Build the Express app without binding a port, so the same wiring is used by
 * the server (src/index.ts) and by integration tests (tests/).
 */
export function createApp(): express.Express {
  const app = express();

  // Behind a reverse proxy (most PaaS hosts) the client IP arrives in X-Forwarded-For.
  // Rate limiting keys on req.ip, so trust exactly the configured number of proxy hops.
  const trustProxy = process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? '1' : '0');
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  // Middleware
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    // Also allow www variant in production
    ...(process.env.FRONTEND_URL ? [`https://www.${new URL(process.env.FRONTEND_URL).hostname}`] : []),
  ].map((o) => o.replace(/\/$/, '')); // strip trailing slashes

  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, health checks)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    })
  );

  // Stripe webhook needs raw body for signature verification
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

  // JSON parsing for all other routes
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/tutors', tutorRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/resources', resourceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/gdpr', gdprRoutes);
  app.use('/api/verification', verificationRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/stripe', stripeRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/parent', parentRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/ai', aiRoutes);

  // Error handling middleware
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err.stack);
    res.status(500).json({
      error: 'Something went wrong!',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  return app;
}
