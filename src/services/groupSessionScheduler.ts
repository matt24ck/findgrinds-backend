import cron from 'node-cron';
import { Op } from 'sequelize';
import { Session } from '../models/Session';
import { Tutor } from '../models/Tutor';
import { User } from '../models/User';
import { stripeService } from './stripeService';
import { emailService } from './emailService';

/**
 * Runs every 15 minutes. For each group session approaching the 24-hour cutoff:
 * - If minimum not met: cancel all RESERVED sessions (no charge)
 * - If minimum met but some still RESERVED: charge them
 */
export function startGroupSessionScheduler(): void {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await checkGroupSessionCutoffs();
    } catch (error) {
      console.error('[GroupScheduler] Error in cutoff check:', error);
    }
  });

  console.log('[GroupScheduler] Started — checking every 15 minutes');
}

async function checkGroupSessionCutoffs(): Promise<void> {
  const now = new Date();
  const cutoffWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

  // Find all RESERVED group sessions scheduled within the next 24 hours
  const reservedSessions = await Session.findAll({
    where: {
      sessionType: 'GROUP',
      status: 'RESERVED',
      scheduledAt: { [Op.lte]: cutoffWindow },
    },
  });

  if (reservedSessions.length === 0) return;

  // Group by tutor + scheduledAt + duration (same time slot)
  const slotGroups = new Map<string, Session[]>();
  for (const session of reservedSessions) {
    const key = `${session.tutorId}|${new Date(session.scheduledAt).toISOString()}|${session.durationMins}`;
    const group = slotGroups.get(key) || [];
    group.push(session);
    slotGroups.set(key, group);
  }

  for (const [key, sessions] of slotGroups) {
    const tutor = await Tutor.findByPk(sessions[0].tutorId, {
      include: [{ model: User }],
    });
    if (!tutor) continue;

    // Count already-confirmed sessions for this slot
    const confirmedCount = await Session.count({
      where: {
        tutorId: sessions[0].tutorId,
        scheduledAt: sessions[0].scheduledAt,
        durationMins: sessions[0].durationMins,
        sessionType: 'GROUP',
        status: 'CONFIRMED',
      },
    });

    const totalParticipants = sessions.length + confirmedCount;
    const tutorUser = (tutor as any).User as User;

    if (totalParticipants >= tutor.minGroupSize) {
      // Minimum met — charge any remaining RESERVED students
      console.log(`[GroupScheduler] Slot ${key}: ${totalParticipants} >= min ${tutor.minGroupSize}. Charging reserved.`);
      await stripeService.checkAndChargeGroupIfMinMet(sessions[0]);
    } else {
      // Minimum NOT met — cancel all reservations
      console.log(`[GroupScheduler] Slot ${key}: ${totalParticipants} < min ${tutor.minGroupSize}. Cancelling.`);

      for (const session of sessions) {
        await session.update({
          status: 'CANCELLED',
          paymentStatus: 'pending',
        });

        // Notify student
        try {
          const student = await User.findByPk(session.studentId);
          if (student) {
            await emailService.sendGroupCancelledMinNotMet(student.email, {
              studentName: student.firstName,
              tutorName: `${tutorUser.firstName} ${tutorUser.lastName}`,
              subject: session.subject,
              scheduledAt: new Date(session.scheduledAt),
              minGroupSize: tutor.minGroupSize,
              actualReservations: totalParticipants,
            });
          }
        } catch (e) {
          console.error('Failed to send group cancellation email:', e);
        }
      }

      // Also refund any already-confirmed sessions for this slot
      const confirmedSessions = await Session.findAll({
        where: {
          tutorId: sessions[0].tutorId,
          scheduledAt: sessions[0].scheduledAt,
          durationMins: sessions[0].durationMins,
          sessionType: 'GROUP',
          status: 'CONFIRMED',
        },
      });

      for (const confirmed of confirmedSessions) {
        if (confirmed.stripePaymentIntentId) {
          try {
            await stripeService.refundSession({
              paymentIntentId: confirmed.stripePaymentIntentId,
              reason: 'Group session cancelled — minimum participants not met',
            });
          } catch (e) {
            console.error(`Failed to refund confirmed session ${confirmed.id}:`, e);
          }
        }
        await confirmed.update({
          status: 'CANCELLED',
          paymentStatus: confirmed.stripePaymentIntentId ? 'refunded' : 'pending',
          refundStatus: confirmed.stripePaymentIntentId ? 'full' : 'none',
        });
      }

      // Notify tutor
      try {
        await emailService.sendGroupCancelledTutorNotification(tutorUser.email, {
          tutorName: tutorUser.firstName,
          subject: sessions[0].subject,
          scheduledAt: new Date(sessions[0].scheduledAt),
          minGroupSize: tutor.minGroupSize,
          actualReservations: totalParticipants,
        });
      } catch (e) {
        console.error('Failed to send tutor notification:', e);
      }
    }
  }
}
