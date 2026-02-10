import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { User } from '../models/User';
import { Tutor } from '../models/Tutor';
import { getUploadUrl, validateUpload, deleteObject, resolveUrl, StorageFolder } from '../services/storageService';

const router = Router();

// POST /api/upload/profile-photo - Get presigned URL for profile photo upload
router.post('/profile-photo', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    const validationError = validateUpload('profiles', contentType);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { uploadUrl, key } = await getUploadUrl('profiles', fileName, contentType, userId);

    res.json({ success: true, data: { uploadUrl, key } });
  } catch (error) {
    console.error('Profile photo upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// PUT /api/upload/profile-photo/confirm - Confirm profile photo upload and save key
router.put('/profile-photo/confirm', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { key } = req.body;

    if (!key || !key.startsWith('profiles/')) {
      return res.status(400).json({ error: 'Invalid key' });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete old photo if it's an S3 key (not a legacy URL)
    if (user.profilePhotoUrl && !user.profilePhotoUrl.startsWith('http')) {
      try {
        await deleteObject(user.profilePhotoUrl);
      } catch {
        // Ignore deletion errors for old files
      }
    }

    user.profilePhotoUrl = key;
    await user.save();

    // Return a signed display URL for immediate rendering
    const displayUrl = await resolveUrl(key, 86400);

    res.json({
      success: true,
      data: { key, displayUrl },
    });
  } catch (error) {
    console.error('Profile photo confirm error:', error);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});

// POST /api/upload/garda-document - Get presigned URL for Garda vetting document
router.post('/garda-document', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    // Verify user is a tutor
    const user = await User.findByPk(userId);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can upload Garda vetting documents' });
    }

    const validationError = validateUpload('documents', contentType);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { uploadUrl, key } = await getUploadUrl('documents', fileName, contentType, userId);

    res.json({ success: true, data: { uploadUrl, key } });
  } catch (error) {
    console.error('Garda document upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /api/upload/resource - Get presigned URL for resource file
router.post('/resource', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    // Verify user is a tutor
    const user = await User.findByPk(userId);
    if (!user || user.userType !== 'TUTOR') {
      return res.status(403).json({ error: 'Only tutors can upload resources' });
    }

    const validationError = validateUpload('resources', contentType);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { uploadUrl, key } = await getUploadUrl('resources', fileName, contentType, userId);

    res.json({ success: true, data: { uploadUrl, key } });
  } catch (error) {
    console.error('Resource upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /api/upload/dispute-evidence - Get presigned URL for dispute evidence
router.post('/dispute-evidence', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { fileName, contentType } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    const validationError = validateUpload('disputes', contentType);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { uploadUrl, key } = await getUploadUrl('disputes', fileName, contentType, userId);

    res.json({ success: true, data: { uploadUrl, key } });
  } catch (error) {
    console.error('Dispute evidence upload URL error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

export default router;
