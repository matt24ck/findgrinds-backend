import axios from 'axios';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials not configured');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(
    'https://zoom.us/oauth/token',
    new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: accountId,
    }),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  cachedToken = response.data.access_token;
  // Expire 5 minutes early to avoid edge cases
  tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;

  return cachedToken!;
}

export const zoomService = {
  async createMeeting(params: {
    topic: string;
    startTime: Date;
    durationMins: number;
  }): Promise<{ joinUrl: string; startUrl: string; meetingId: number }> {
    const token = await getAccessToken();

    const response = await axios.post(
      'https://api.zoom.us/v2/users/me/meetings',
      {
        topic: params.topic,
        type: 2, // Scheduled meeting
        start_time: params.startTime.toISOString(),
        duration: params.durationMins,
        timezone: 'Europe/Dublin',
        settings: {
          join_before_host: true,
          waiting_room: false,
          meeting_authentication: false,
          audio: 'both',
          auto_recording: 'none',
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      joinUrl: response.data.join_url,
      startUrl: response.data.start_url,
      meetingId: response.data.id,
    };
  },

  async deleteMeeting(meetingId: string): Promise<void> {
    const token = await getAccessToken();

    await axios.delete(
      `https://api.zoom.us/v2/meetings/${meetingId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  },
};

export default zoomService;
