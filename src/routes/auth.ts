import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { emailService } from '../services/emailService';
import { resolveUrl } from '../services/storageService';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, userType, isGardaVetted, subjects, levels, dateOfBirth, area } = req.body;

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
      dateOfBirth: dateOfBirth || undefined,
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
        area: area || undefined,
        baseHourlyRate: 40, // Default rate, can be updated later
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, userType: user.userType },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    // Return user without password
    const userResponse = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      profilePhotoUrl: await resolveUrl(user.profilePhotoUrl),
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
      { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as any }
    );

    // Return user without password
    const userResponse = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      profilePhotoUrl: await resolveUrl(user.profilePhotoUrl),
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

    const userData = user.toJSON();
    userData.profilePhotoUrl = (await resolveUrl(userData.profilePhotoUrl)) || undefined;

    res.json({ success: true, data: userData });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();

    // Send confirmation email (fire-and-forget)
    emailService.sendPasswordChangedEmail(user.email, user.firstName);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Always return success to avoid leaking account existence
    const successMessage = 'If an account exists with that email, a reset link has been sent.';

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.json({ success: true, message: successMessage });
    }

    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Store hashed token with 1-hour expiry
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'https://findgrinds.ie';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send email (fire-and-forget)
    emailService.sendPasswordResetEmail(user.email, user.firstName, resetUrl);

    res.json({ success: true, message: successMessage });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    // Hash the incoming token to compare with stored hash
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Update password and clear reset fields
    user.password = await bcrypt.hash(newPassword, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Send confirmation email (fire-and-forget)
    emailService.sendPasswordChangedEmail(user.email, user.firstName);

    res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  // JWT is stateless, so logout is handled client-side by removing the token
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
