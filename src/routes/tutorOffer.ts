import { Router, Request, Response } from 'express';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { authMiddleware } from '../middleware/auth';
import { resolveUrl } from '../services/storageService';
import { tutorOfferService } from '../services/tutorOfferService';

const router = Router();

// GET /api/tutor-offer/join/:code - Public: who is behind this join link?
router.get('/join/:code', async (req: Request, res: Response) => {
  try {
    const tutor = await tutorOfferService.findTutorByInviteCode(req.params.code as string);
    if (!tutor) {
      return res.status(404).json({ error: 'This join link is not valid' });
    }
    const tutorUser = (tutor as any).User as User;

    res.json({
      success: true,
      data: {
        tutorId: tutor.id,
        firstName: tutorUser.firstName,
        lastName: tutorUser.lastName,
        profilePhotoUrl: await resolveUrl(tutorUser.profilePhotoUrl),
        headline: tutor.headline,
        subjects: tutor.subjects,
      },
    });
  } catch (error) {
    console.error('Join link lookup error:', error);
    res.status(500).json({ error: 'Failed to look up join link' });
  }
});

async function requireTutor(req: Request, res: Response): Promise<Tutor | null> {
  if ((req as any).user.userType !== 'TUTOR') {
    res.status(403).json({ error: 'Only tutors can use this' });
    return null;
  }
  const tutor = await Tutor.findOne({ where: { userId: (req as any).user.userId } });
  if (!tutor) {
    res.status(404).json({ error: 'Tutor profile not found' });
    return null;
  }
  return tutor;
}

// GET /api/tutor-offer/status - Tutor's join link, referral count and free-month eligibility
router.get('/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const tutor = await requireTutor(req, res);
    if (!tutor) return;
    res.json({ success: true, data: await tutorOfferService.getStatus(tutor) });
  } catch (error) {
    console.error('Tutor offer status error:', error);
    res.status(500).json({ error: 'Failed to load offer status' });
  }
});

const ACTIVATE_ERRORS: Record<string, string> = {
  already_activated: 'You have already used your free Professional month.',
  not_qualified: 'A student who joined through your link needs to make a paid booking with you first.',
  deadline_passed: 'The deadline to qualify for the free Professional month (31 October) has passed.',
  offer_ended: 'This offer has ended.',
  already_on_paid_plan: 'You are already on a paid plan.',
};

// POST /api/tutor-offer/pro-month/activate - Start the free Professional month
router.post('/pro-month/activate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const tutor = await requireTutor(req, res);
    if (!tutor) return;
    const { url } = await tutorOfferService.startProMonthCheckout(tutor);
    res.json({ success: true, data: { url } });
  } catch (error: any) {
    if (error?.code && ACTIVATE_ERRORS[error.code]) {
      return res.status(400).json({ error: ACTIVATE_ERRORS[error.code], code: error.code });
    }
    console.error('Activate pro month error:', error);
    res.status(500).json({ error: 'Failed to activate free month' });
  }
});

export default router;
