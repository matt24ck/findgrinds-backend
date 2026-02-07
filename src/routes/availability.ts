import { Router, Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { Tutor, TutorWeeklySlot, TutorDateOverride, Session } from '../models';
import { authMiddleware, tutorOnly } from '../middleware/auth';

const router = Router();

type SessionMedium = 'IN_PERSON' | 'VIDEO' | 'GROUP';
const VALID_MEDIA: SessionMedium[] = ['IN_PERSON', 'VIDEO', 'GROUP'];

// Helper: validate HH:mm format with 00 or 30 minutes
function isValidSlotTime(time: string): boolean {
  return /^([01]\d|2[0-3]):(00|30)$/.test(time);
}

// Helper: compute end time for a 30-min slot
function getEndTime(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  const endMinutes = m + 30;
  const endHour = endMinutes >= 60 ? h + 1 : h;
  const endMin = endMinutes >= 60 ? '00' : '30';
  return `${endHour.toString().padStart(2, '0')}:${endMin}`;
}

// Helper: generate all 30-min slot keys covered by a booking
function generateSlotKeys(scheduledAt: Date, durationMins: number): string[] {
  const keys: string[] = [];
  const numSlots = Math.ceil(durationMins / 30);
  for (let i = 0; i < numSlots; i++) {
    const slotTime = new Date(scheduledAt.getTime() + i * 30 * 60 * 1000);
    const dateStr = slotTime.toISOString().split('T')[0];
    const hours = slotTime.getHours().toString().padStart(2, '0');
    const mins = slotTime.getMinutes() < 30 ? '00' : '30';
    keys.push(`${dateStr}|${hours}:${mins}`);
  }
  return keys;
}

// ============================================
// AVAILABILITY STATUS (tutor dashboard)
// ============================================

/**
 * GET /api/availability/status
 * Check if the authenticated tutor has configured any availability
 */
router.get('/status', authMiddleware, tutorOnly, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const slots = await TutorWeeklySlot.findAll({ where: { tutorId: tutor.id } });
    const mediaConfigured = [...new Set(slots.map(s => s.medium))];

    res.json({
      success: true,
      data: {
        hasWeeklySlots: slots.length > 0,
        slotCount: slots.length,
        mediaConfigured,
      },
    });
  } catch (error) {
    console.error('Get availability status error:', error);
    res.status(500).json({ error: 'Failed to get availability status' });
  }
});

// ============================================
// WEEKLY TEMPLATE
// ============================================

/**
 * GET /api/availability/:tutorId/weekly
 * Get a tutor's recurring weekly availability template
 */
router.get('/:tutorId/weekly', async (req: Request, res: Response) => {
  try {
    const { tutorId } = req.params;

    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const slots = await TutorWeeklySlot.findAll({
      where: { tutorId },
      order: [['dayOfWeek', 'ASC'], ['startTime', 'ASC'], ['medium', 'ASC']],
    });

    res.json({
      success: true,
      data: { slots },
    });
  } catch (error) {
    console.error('Get weekly availability error:', error);
    res.status(500).json({ error: 'Failed to get weekly availability' });
  }
});

/**
 * PUT /api/availability/weekly
 * Full-replace the tutor's weekly template
 */
router.put('/weekly', authMiddleware, tutorOnly, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const { slots } = req.body;
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots must be an array' });
    }

    // Validate each slot
    for (const slot of slots) {
      if (typeof slot.dayOfWeek !== 'number' || slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
        return res.status(400).json({ error: `Invalid dayOfWeek: ${slot.dayOfWeek}` });
      }
      if (!isValidSlotTime(slot.startTime)) {
        return res.status(400).json({ error: `Invalid startTime: ${slot.startTime}. Must be HH:mm with minutes 00 or 30.` });
      }
      if (!VALID_MEDIA.includes(slot.medium)) {
        return res.status(400).json({ error: `Invalid medium: ${slot.medium}` });
      }
    }

    // Full replace in a transaction
    const result = await sequelize.transaction(async (t) => {
      await TutorWeeklySlot.destroy({ where: { tutorId: tutor.id }, transaction: t });

      if (slots.length === 0) return [];

      const newSlots = await TutorWeeklySlot.bulkCreate(
        slots.map((s: any) => ({
          tutorId: tutor.id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          medium: s.medium,
        })),
        { transaction: t, ignoreDuplicates: true }
      );

      return newSlots;
    });

    res.json({
      success: true,
      data: { slots: result },
    });
  } catch (error) {
    console.error('Set weekly availability error:', error);
    res.status(500).json({ error: 'Failed to set weekly availability' });
  }
});

// ============================================
// DATE OVERRIDES
// ============================================

/**
 * GET /api/availability/:tutorId/overrides
 * Get date overrides for a date range
 */
router.get('/:tutorId/overrides', authMiddleware, tutorOnly, async (req: Request, res: Response) => {
  try {
    const { tutorId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const overrides = await TutorDateOverride.findAll({
      where: {
        tutorId,
        date: { [Op.between]: [startDate as string, endDate as string] },
      },
      order: [['date', 'ASC'], ['startTime', 'ASC']],
    });

    res.json({
      success: true,
      data: { overrides },
    });
  } catch (error) {
    console.error('Get date overrides error:', error);
    res.status(500).json({ error: 'Failed to get date overrides' });
  }
});

/**
 * PUT /api/availability/overrides
 * Upsert date overrides
 */
router.put('/overrides', authMiddleware, tutorOnly, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const { overrides } = req.body;
    if (!Array.isArray(overrides)) {
      return res.status(400).json({ error: 'overrides must be an array' });
    }

    // Validate each override
    for (const o of overrides) {
      if (!o.date || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) {
        return res.status(400).json({ error: `Invalid date: ${o.date}` });
      }
      if (!isValidSlotTime(o.startTime)) {
        return res.status(400).json({ error: `Invalid startTime: ${o.startTime}` });
      }
      if (!VALID_MEDIA.includes(o.medium)) {
        return res.status(400).json({ error: `Invalid medium: ${o.medium}` });
      }
      if (typeof o.isAvailable !== 'boolean') {
        return res.status(400).json({ error: 'isAvailable must be a boolean' });
      }
    }

    // Upsert each override
    const results = [];
    for (const o of overrides) {
      const [record] = await TutorDateOverride.upsert({
        tutorId: tutor.id,
        date: o.date,
        startTime: o.startTime,
        medium: o.medium,
        isAvailable: o.isAvailable,
      } as any);
      results.push(record);
    }

    res.json({
      success: true,
      data: { overrides: results },
    });
  } catch (error) {
    console.error('Set date overrides error:', error);
    res.status(500).json({ error: 'Failed to set date overrides' });
  }
});

/**
 * DELETE /api/availability/overrides
 * Remove date overrides by ID (reverts to weekly template)
 */
router.delete('/overrides', authMiddleware, tutorOnly, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const tutor = await Tutor.findOne({ where: { userId } });
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor profile not found' });
    }

    const { overrideIds } = req.body;
    if (!Array.isArray(overrideIds)) {
      return res.status(400).json({ error: 'overrideIds must be an array' });
    }

    await TutorDateOverride.destroy({
      where: {
        id: { [Op.in]: overrideIds },
        tutorId: tutor.id,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete date overrides error:', error);
    res.status(500).json({ error: 'Failed to delete date overrides' });
  }
});

// ============================================
// COMPUTED AVAILABILITY SLOTS (main endpoint)
// ============================================

/**
 * Compute real available slots for a tutor, date range, and medium.
 * Exported so it can be reused by the tutors.ts route.
 */
export async function computeAvailability(
  tutorId: string,
  startDate: string,
  endDate: string,
  medium: SessionMedium
) {
  // 1. Fetch tutor for rates and group settings
  const tutor = await Tutor.findByPk(tutorId);
  if (!tutor) throw new Error('Tutor not found');

  // 2. Fetch weekly template slots for this medium
  const weeklySlots = await TutorWeeklySlot.findAll({
    where: { tutorId, medium },
  });

  // 3. Fetch date overrides in range for this medium
  const overrides = await TutorDateOverride.findAll({
    where: {
      tutorId,
      medium,
      date: { [Op.between]: [startDate, endDate] },
    },
  });

  // 4. Fetch existing non-cancelled bookings in the date range (ALL media)
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  const existingBookings = await Session.findAll({
    where: {
      tutorId,
      scheduledAt: { [Op.between]: [start, end] },
      status: { [Op.ne]: 'CANCELLED' },
    },
  });

  // 5. Build lookups
  const weeklySet = new Set(weeklySlots.map(s => `${s.dayOfWeek}|${s.startTime}`));

  const overrideMap = new Map<string, boolean>();
  for (const o of overrides) {
    overrideMap.set(`${o.date}|${o.startTime}`, o.isAvailable);
  }

  // Booking lookup: key by "YYYY-MM-DD|HH:mm"
  // Each booking covers all 30-min slots for its full duration
  const bookingMap = new Map<string, { oneToOneBooked: boolean; groupCount: number }>();
  for (const b of existingBookings) {
    const dt = new Date(b.scheduledAt);
    const duration = b.durationMins || 60;
    const slotKeys = generateSlotKeys(dt, duration);

    for (const key of slotKeys) {
      const entry = bookingMap.get(key) || { oneToOneBooked: false, groupCount: 0 };
      if (b.sessionType === 'GROUP') {
        entry.groupCount++;
      } else {
        entry.oneToOneBooked = true;
      }
      bookingMap.set(key, entry);
    }
  }

  // 6. Iterate day by day
  const result: any[] = [];
  const currentDate = new Date(`${startDate}T00:00:00`);
  const endDate_ = new Date(`${endDate}T00:00:00`);

  while (currentDate <= endDate_) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay();

    // Generate all 30-min slots from 08:00 to 21:30
    for (let hour = 8; hour < 22; hour++) {
      for (const minute of ['00', '30']) {
        const startTime = `${hour.toString().padStart(2, '0')}:${minute}`;
        const overrideKey = `${dateStr}|${startTime}`;

        // A: Determine base availability from template or override
        let isTemplateAvailable: boolean;
        if (overrideMap.has(overrideKey)) {
          isTemplateAvailable = overrideMap.get(overrideKey)!;
        } else {
          isTemplateAvailable = weeklySet.has(`${dayOfWeek}|${startTime}`);
        }

        if (!isTemplateAvailable) continue; // Skip unavailable slots

        // B: Check bookings
        const bookingKey = `${dateStr}|${startTime}`;
        const booking = bookingMap.get(bookingKey);

        let available = true;
        let groupSpotsLeft: number | undefined;
        let groupSpotsTotal: number | undefined;

        if (medium === 'GROUP') {
          if (booking?.oneToOneBooked) {
            available = false;
          } else if (booking && booking.groupCount >= tutor.maxGroupSize) {
            available = false;
          } else {
            groupSpotsTotal = tutor.maxGroupSize;
            groupSpotsLeft = tutor.maxGroupSize - (booking?.groupCount || 0);
          }
        } else {
          // 1:1 (VIDEO or IN_PERSON): blocked if ANY booking exists
          if (booking?.oneToOneBooked || (booking && booking.groupCount > 0)) {
            available = false;
          }
        }

        // Skip past slots
        const slotDateTime = new Date(`${dateStr}T${startTime}:00`);
        if (slotDateTime <= new Date()) {
          continue;
        }

        const hourlyRate = medium === 'GROUP'
          ? Number(tutor.groupHourlyRate || tutor.baseHourlyRate)
          : Number(tutor.baseHourlyRate);

        result.push({
          date: dateStr,
          startTime,
          endTime: getEndTime(startTime),
          available,
          medium,
          price: hourlyRate,
          ...(medium === 'GROUP' ? { groupSpotsLeft, groupSpotsTotal } : {}),
        });
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return { tutorId, slots: result };
}

/**
 * GET /api/availability/:tutorId/slots
 * Compute and return available slots for a date range and medium
 */
router.get('/:tutorId/slots', async (req: Request, res: Response) => {
  try {
    const { tutorId } = req.params;
    const medium = (req.query.medium as SessionMedium) || 'VIDEO';
    const startDate = (req.query.startDate as string) || new Date().toISOString().split('T')[0];
    const endDateParam = req.query.endDate as string;
    const endDate = endDateParam || (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })();

    if (!VALID_MEDIA.includes(medium)) {
      return res.status(400).json({ error: `Invalid medium: ${medium}` });
    }

    const tutor = await Tutor.findByPk(tutorId);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    const data = await computeAvailability(tutorId, startDate, endDate, medium);

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get availability slots error:', error);
    res.status(500).json({ error: 'Failed to get availability slots' });
  }
});

export default router;
