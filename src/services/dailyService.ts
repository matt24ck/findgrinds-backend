import axios from 'axios';

const DAILY_API_URL = 'https://api.daily.co/v1';

function getApiKey(): string {
  const key = process.env.DAILY_API_KEY;
  if (!key) {
    throw new Error('DAILY_API_KEY not configured');
  }
  return key;
}

function headers() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

export const dailyService = {
  async createRoom(sessionId: string, expiresAt: Date): Promise<{ roomName: string; roomUrl: string }> {
    const exp = Math.floor(expiresAt.getTime() / 1000) + 3600; // +1 hour buffer

    const response = await axios.post(
      `${DAILY_API_URL}/rooms`,
      {
        name: sessionId,
        properties: {
          exp,
          enable_chat: true,
          enable_screenshare: true,
          max_participants: 3,
          enable_knocking: false,
          start_video_off: false,
          start_audio_off: false,
        },
      },
      { headers: headers() }
    );

    return {
      roomName: response.data.name,
      roomUrl: response.data.url,
    };
  },

  async createMeetingToken(
    roomName: string,
    userId: string,
    userName: string,
    expiresAt: Date
  ): Promise<{ token: string }> {
    const exp = Math.floor(expiresAt.getTime() / 1000) + 3600; // +1 hour buffer

    const response = await axios.post(
      `${DAILY_API_URL}/meeting-tokens`,
      {
        properties: {
          room_name: roomName,
          user_name: userName,
          user_id: userId,
          exp,
          is_owner: false,
        },
      },
      { headers: headers() }
    );

    return { token: response.data.token };
  },

  async deleteRoom(roomName: string): Promise<void> {
    await axios.delete(`${DAILY_API_URL}/rooms/${roomName}`, {
      headers: headers(),
    });
  },
};

export default dailyService;
