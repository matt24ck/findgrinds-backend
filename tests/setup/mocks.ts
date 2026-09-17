/**
 * Module mocks applied to every test file (jest `setupFilesAfterEnv`).
 * Third-party side effects are replaced so the safety-path tests exercise our
 * logic only: Stripe refunds, email, video rooms and S3 URL signing.
 */

jest.mock('../../src/services/stripeService', () => ({
  stripeService: {
    refundSession: jest.fn().mockResolvedValue({ refundId: 're_test', amountRefunded: 0 }),
    refundSubscriptionInvoice: jest.fn().mockResolvedValue({ refundId: 're_test', amountRefunded: 0 }),
    createCheckoutSession: jest.fn(),
    createConnectAccount: jest.fn(),
    handleWebhook: jest.fn(),
  },
}));

jest.mock('../../src/services/emailService', () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (target, prop: string) => {
      if (!(prop in target)) target[prop] = jest.fn().mockResolvedValue(undefined);
      return target[prop];
    },
  };
  const emailService = new Proxy({}, handler);
  return { emailService, default: emailService };
});

jest.mock('../../src/services/videoService', () => ({
  videoService: {
    getProvider: jest.fn().mockReturnValue('daily'),
    deleteMeeting: jest.fn().mockResolvedValue(undefined),
    createMeeting: jest.fn().mockResolvedValue(null),
    createToken: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/services/storageService', () => ({
  resolveUrl: jest.fn(async (key: string | null | undefined) => key ?? null),
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
  getSignedUploadUrl: jest.fn(),
}));

jest.mock('resend', () => {
  const send = jest.fn().mockResolvedValue({ data: { id: 'email_test' }, error: null });
  return {
    __mockSend: send,
    Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
  };
});
