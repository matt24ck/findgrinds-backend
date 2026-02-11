import { dailyService } from './dailyService';
import { zoomService } from './zoomService';

const provider = process.env.VIDEO_PROVIDER || 'daily';

export const videoService = {
  getProvider(): string {
    return provider;
  },

  async createMeeting(params: {
    sessionId: string;
    topic: string;
    startTime: Date;
    durationMins: number;
  }): Promise<{ meetingLink: string; meetingId: string }> {
    if (provider === 'zoom') {
      const meeting = await zoomService.createMeeting({
        topic: params.topic,
        startTime: params.startTime,
        durationMins: params.durationMins,
      });
      return {
        meetingLink: meeting.joinUrl,
        meetingId: String(meeting.meetingId),
      };
    }

    // Daily.co
    const endTime = new Date(params.startTime.getTime() + params.durationMins * 60 * 1000);
    const room = await dailyService.createRoom(params.sessionId, endTime);
    return {
      meetingLink: `/sessions/${params.sessionId}`,
      meetingId: room.roomName,
    };
  },

  async deleteMeeting(meetingId: string): Promise<void> {
    if (provider === 'zoom') {
      await zoomService.deleteMeeting(meetingId);
    } else {
      await dailyService.deleteRoom(meetingId);
    }
  },

  async createToken(
    meetingId: string,
    userId: string,
    userName: string,
    expiresAt: Date
  ): Promise<{ token: string; roomUrl: string } | null> {
    if (provider === 'zoom') {
      return null; // Zoom doesn't need client-side tokens
    }

    const { token } = await dailyService.createMeetingToken(meetingId, userId, userName, expiresAt);
    return {
      token,
      roomUrl: `https://${process.env.DAILY_DOMAIN || 'findgrinds'}.daily.co/${meetingId}`,
    };
  },
};

export default videoService;
