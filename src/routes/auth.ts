import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { emailService } from '../services/emailService';

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, userType, isGardaVetted, subjects, levels } = req.body;

    // Validate input
    if (!email || !password || !firstName || !lastName || !userType) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await User.create({
      email,
      password: hashedPassword,
      firstName,
      lastName,
      userType,
      gardaVettingSelfDeclared: userType === 'TUTOR' && isGardaVetted === true,
    });

    // If tutor, create tutor profile
    if (userType === 'TUTOR') {
      await Tutor.create({
        userId: user.id,
        headline: `${firstName} ${lastName} - Tutor`,
        qualifications: [],
        subjects: subjects || [],
        levels: levels || [],
        baseHourlyRate: 40, // Default rate, can be updated later
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, userType: user.userType },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return user without password
    const userResponse = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      profilePhotoUrl: user.profilePhotoUrl,
      gardaVettingSelfDeclared: user.gardaVettingSelfDeclared,
      gardaVettingVerified: user.gardaVettingVerified,
      createdAt: user.createdAt,
    };

    // Send welcome email (async, don't wait)
    emailService.sendWelcomeEmail(user.email, user.firstName, user.userType);

    res.status(201).json({
      success: true,
      data: { user: userResponse, token },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, userType: user.userType },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // Return user without password
    const userResponse = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      profilePhotoUrl: user.profilePhotoUrl,
      gardaVettingSelfDeclared: user.gardaVettingSelfDeclared,
      gardaVettingVerified: user.gardaVettingVerified,
      createdAt: user.createdAt,
    };

    res.json({
      success: true,
      data: { user: userResponse, token },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// GET /api/auth/me
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret') as { userId: string };

    const user = await User.findByPk(decoded.userId, {
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  // JWT is stateless, so logout is handled client-side by removing the token
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
