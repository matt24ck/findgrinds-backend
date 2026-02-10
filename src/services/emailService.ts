import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'FindGrinds <noreply@findgrinds.ie>';

const EMAIL_FOOTER = `
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            This is an automated email from noreply@findgrinds.ie — please do not reply.<br><br>
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
`;

const emailHead = `
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
`;

const bodyStyle = 'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;';

const emailHeader = `
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
            <p style="color: #5D6D7E; margin: 5px 0 0 0;">Find the Right Grinds Tutor</p>
          </div>
`;

const emailHeaderCompact = `
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
          </div>
`;

// Email templates
const templates = {
  welcome: (firstName: string) => ({
    subject: 'Welcome to FindGrinds!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeader}

          <h2 style="color: #2C3E50;">Welcome, ${firstName}!</h2>

          <p>Thanks for joining FindGrinds - Ireland's platform for connecting students with quality tutors for Junior and Leaving Cert preparation.</p>

          <p>Here's what you can do next:</p>

          <ul style="padding-left: 20px;">
            <li><strong>Browse Tutors</strong> - Find qualified tutors in your subject</li>
            <li><strong>Book Sessions</strong> - Schedule lessons at times that suit you</li>
            <li><strong>Get Resources</strong> - Access study materials from top tutors</li>
          </ul>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/tutors" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Browse Tutors</a>
          </div>

          <p style="color: #5D6D7E; font-size: 14px;">If you have any questions, contact us at <a href="mailto:support@findgrinds.ie" style="color: #2D9B6E;">support@findgrinds.ie</a>.</p>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  welcomeTutor: (firstName: string) => ({
    subject: 'Welcome to FindGrinds - Start Teaching Today!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeader}

          <h2 style="color: #2C3E50;">Welcome to the team, ${firstName}!</h2>

          <p>You're now part of FindGrinds - Ireland's growing community of tutors helping students succeed in their Junior and Leaving Cert exams.</p>

          <p>Here's how to get started:</p>

          <ol style="padding-left: 20px;">
            <li><strong>Complete your profile</strong> - Add your qualifications, subjects, and rates</li>
            <li><strong>Set your availability</strong> - Let students know when you're free</li>
            <li><strong>Get verified</strong> - Upload your Garda vetting to build trust</li>
            <li><strong>Upload resources</strong> - Sell your notes and study guides</li>
          </ol>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
          </div>

          <div style="background-color: #F0F7F4; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px;"><strong>Tip:</strong> Tutors with verified Garda vetting and complete profiles get more bookings!</p>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  bookingConfirmationStudent: (data: {
    studentName: string;
    tutorName: string;
    subject: string;
    date: string;
    time: string;
    price: string;
    sessionType?: 'VIDEO' | 'IN_PERSON' | 'GROUP';
    meetingLink?: string;
  }) => {
    const sessionTypeLabel = data.sessionType === 'IN_PERSON' ? 'In-Person Session' :
      data.sessionType === 'GROUP' ? 'Group Class' : '1-on-1 Video Session';

    const sessionTypeNote = data.sessionType === 'IN_PERSON'
      ? `<p>Your tutor will contact you to arrange the meeting location.</p>`
      : data.sessionType === 'GROUP'
      ? `<p>You'll receive details about the group class location and other participants before your session.</p>`
      : data.meetingLink
      ? ''
      : `<p>You'll receive a video call link before your session.</p>`;

    const zoomBlock = data.meetingLink ? `
            <div style="text-align: center; margin: 20px 0;">
              <a href="${data.meetingLink}" style="display: inline-block; background-color: #2D8CFF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Join Zoom Meeting</a>
            </div>
            <p style="color: #5D6D7E; font-size: 13px; text-align: center;">For safeguarding purposes, we recommend recording this session using the Record button in Zoom.</p>
    ` : '';

    return {
      subject: `Booking Confirmed - ${data.subject} with ${data.tutorName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>${emailHead}</head>
          <body style="${bodyStyle}">
            ${emailHeaderCompact}

            <h2 style="color: #2C3E50;">Booking Confirmed!</h2>

            <p>Hi ${data.studentName},</p>

            <p>Great news! Your session has been confirmed.</p>

            <div style="background-color: #F8F9FA; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #2C3E50;">Session Details</h3>
              <p style="margin: 5px 0;"><strong>Type:</strong> ${sessionTypeLabel}</p>
              <p style="margin: 5px 0;"><strong>Subject:</strong> ${data.subject}</p>
              <p style="margin: 5px 0;"><strong>Tutor:</strong> ${data.tutorName}</p>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${data.date}</p>
              <p style="margin: 5px 0;"><strong>Time:</strong> ${data.time}</p>
              <p style="margin: 5px 0;"><strong>Price:</strong> ${data.price}</p>
            </div>

            ${sessionTypeNote}
            ${zoomBlock}

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://findgrinds.ie/dashboard/student" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View My Sessions</a>
            </div>

            ${EMAIL_FOOTER}
          </body>
        </html>
      `,
    };
  },

  bookingConfirmationTutor: (data: {
    tutorName: string;
    studentName: string;
    subject: string;
    date: string;
    time: string;
    earnings: string;
    sessionType?: 'VIDEO' | 'IN_PERSON' | 'GROUP';
    meetingLink?: string;
  }) => {
    const sessionTypeLabel = data.sessionType === 'IN_PERSON' ? 'In-Person Session' :
      data.sessionType === 'GROUP' ? 'Group Class' : '1-on-1 Video Session';

    const sessionTypeNote = data.sessionType === 'IN_PERSON'
      ? `<p style="margin-top: 15px;"><strong>Note:</strong> Please contact the student to arrange the meeting location.</p>`
      : data.sessionType === 'GROUP'
      ? `<p style="margin-top: 15px;"><strong>Note:</strong> This is a group class. Please send the class details to the student.</p>`
      : '';

    const zoomBlock = data.meetingLink ? `
            <div style="text-align: center; margin: 20px 0;">
              <a href="${data.meetingLink}" style="display: inline-block; background-color: #2D8CFF; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Join Zoom Meeting</a>
            </div>
            <p style="color: #5D6D7E; font-size: 13px; text-align: center;">This link has also been shared with the student. For safeguarding purposes, we recommend recording this session using the Record button in Zoom.</p>
    ` : '';

    return {
      subject: `New Booking - ${data.subject} with ${data.studentName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>${emailHead}</head>
          <body style="${bodyStyle}">
            ${emailHeaderCompact}

            <h2 style="color: #2C3E50;">New Booking!</h2>

            <p>Hi ${data.tutorName},</p>

            <p>You have a new session booked!</p>

            <div style="background-color: #F0F7F4; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #2C3E50;">Session Details</h3>
              <p style="margin: 5px 0;"><strong>Type:</strong> ${sessionTypeLabel}</p>
              <p style="margin: 5px 0;"><strong>Subject:</strong> ${data.subject}</p>
              <p style="margin: 5px 0;"><strong>Student:</strong> ${data.studentName}</p>
              <p style="margin: 5px 0;"><strong>Date:</strong> ${data.date}</p>
              <p style="margin: 5px 0;"><strong>Time:</strong> ${data.time}</p>
              <p style="margin: 5px 0;"><strong>Your earnings:</strong> ${data.earnings}</p>
              ${sessionTypeNote}
            </div>

            ${zoomBlock}

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View My Schedule</a>
            </div>

            ${EMAIL_FOOTER}
          </body>
        </html>
      `,
    };
  },

  sessionReminder: (data: {
    name: string;
    tutorName: string;
    subject: string;
    date: string;
    time: string;
    zoomLink?: string;
  }) => ({
    subject: `Reminder: ${data.subject} session tomorrow`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Session Reminder</h2>

          <p>Hi ${data.name},</p>

          <p>Just a friendly reminder about your upcoming session:</p>

          <div style="background-color: #FEF3C7; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F59E0B;">
            <p style="margin: 5px 0;"><strong>Subject:</strong> ${data.subject}</p>
            <p style="margin: 5px 0;"><strong>Tutor:</strong> ${data.tutorName}</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${data.date}</p>
            <p style="margin: 5px 0;"><strong>Time:</strong> ${data.time}</p>
          </div>

          ${data.zoomLink ? `
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.zoomLink}" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Join Zoom Meeting</a>
          </div>
          ` : ''}

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  gardaVettingApproved: (firstName: string) => ({
    subject: 'Your Garda Vetting has been verified!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <div style="text-align: center; margin: 20px 0;">
            <div style="display: inline-block; background-color: #D1FAE5; border-radius: 50%; padding: 20px;">
              <span style="font-size: 40px;">&#10003;</span>
            </div>
          </div>

          <h2 style="color: #2C3E50; text-align: center;">Garda Vetting Verified!</h2>

          <p>Hi ${firstName},</p>

          <p>Great news! Your Garda vetting document has been verified. Your profile now displays the verified badge, which helps build trust with students and parents.</p>

          <div style="background-color: #F0F7F4; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; color: #2D9B6E; font-weight: 600;">Your profile is now Garda Vetted &#10003;</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Your Profile</a>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  gardaVettingRejected: (firstName: string, reason?: string) => ({
    subject: 'Garda Vetting verification update',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Garda Vetting Update</h2>

          <p>Hi ${firstName},</p>

          <p>Unfortunately, we were unable to verify the Garda vetting document you uploaded.</p>

          ${reason ? `
          <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
            <p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>
          </div>
          ` : ''}

          <p>Please upload a clear, valid Garda vetting certificate and try again. If you believe this is an error, contact us at <a href="mailto:support@findgrinds.ie" style="color: #2D9B6E;">support@findgrinds.ie</a>.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor/verification" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upload New Document</a>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  // --- New templates ---

  passwordReset: (firstName: string, resetLink: string) => ({
    subject: 'Reset your FindGrinds password',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Reset Your Password</h2>

          <p>Hi ${firstName},</p>

          <p>We received a request to reset the password for your FindGrinds account. Click the button below to set a new password:</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 14px 35px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
          </div>

          <p style="color: #5D6D7E; font-size: 14px;">This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password will not be changed.</p>

          <p style="color: #5D6D7E; font-size: 13px;">If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${resetLink}" style="color: #2D9B6E; word-break: break-all;">${resetLink}</a></p>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  passwordChanged: (firstName: string) => ({
    subject: 'Your password has been changed',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Password Changed</h2>

          <p>Hi ${firstName},</p>

          <p>Your FindGrinds password was successfully changed.</p>

          <p>If you did not make this change, please contact us immediately at <a href="mailto:support@findgrinds.ie" style="color: #2D9B6E; font-weight: 600;">support@findgrinds.ie</a> to secure your account.</p>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  accountDeleted: (firstName: string) => ({
    subject: 'Your FindGrinds account has been deleted',
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Account Deleted</h2>

          <p>Hi ${firstName},</p>

          <p>Your FindGrinds account has been permanently deleted as requested. All your personal data has been removed from our systems.</p>

          <p style="color: #5D6D7E; font-size: 14px;">Some anonymised records (such as transaction history) may be retained for legal and financial compliance purposes, in accordance with Irish law and GDPR.</p>

          <p>We're sorry to see you go. If you ever want to return, you're welcome to create a new account at any time.</p>

          <p>If you did not request this deletion, please contact us immediately at <a href="mailto:support@findgrinds.ie" style="color: #2D9B6E; font-weight: 600;">support@findgrinds.ie</a>.</p>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  newMessageNotification: (data: {
    recipientName: string;
    senderName: string;
    messagePreview: string;
    conversationUrl: string;
  }) => ({
    subject: `New message from ${data.senderName} on FindGrinds`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">New Message</h2>

          <p>Hi ${data.recipientName},</p>

          <p><strong>${data.senderName}</strong> sent you a message:</p>

          <div style="background-color: #F8F9FA; padding: 15px 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2D9B6E;">
            <p style="margin: 0; color: #5D6D7E; font-style: italic;">"${data.messagePreview}${data.messagePreview.length >= 150 ? '...' : ''}"</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.conversationUrl}" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Conversation</a>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),

  subscriptionConfirmation: (data: {
    firstName: string;
    tierName: string;
    price: string;
  }) => {
    const features = data.tierName === 'Enterprise' ? [
      'Gold verified tick on your profile',
      '"Enterprise Tutor" badge',
      'Top placement in all search results',
      'Link your profile to your organisation',
      'Priority email support',
    ] : [
      'Green verified tick on your profile',
      '"Professional Tutor" badge',
      'Priority in search results',
      'Priority email support',
    ];

    return {
      subject: `Welcome to FindGrinds ${data.tierName}!`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>${emailHead}</head>
          <body style="${bodyStyle}">
            ${emailHeaderCompact}

            <h2 style="color: #2C3E50;">Welcome to ${data.tierName}!</h2>

            <p>Hi ${data.firstName},</p>

            <p>Your subscription to <strong>FindGrinds ${data.tierName}</strong> (${data.price}/month) is now active.</p>

            <div style="background-color: #F0F7F4; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="margin: 0 0 15px 0; color: #2C3E50;">Your ${data.tierName} Benefits</h3>
              ${features.map(f => `<p style="margin: 8px 0; color: #5D6D7E;">&#10003; ${f}</p>`).join('')}
            </div>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
            </div>

            <p style="color: #5D6D7E; font-size: 14px;">You can manage or cancel your subscription at any time from your dashboard settings.</p>

            ${EMAIL_FOOTER}
          </body>
        </html>
      `,
    };
  },

  sessionCancelled: (data: {
    recipientName: string;
    otherPartyName: string;
    subject: string;
    date: string;
    time: string;
    cancelledBy: 'student' | 'tutor';
    dashboardUrl: string;
  }) => ({
    subject: `Session Cancelled - ${data.subject} on ${data.date}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Session Cancelled</h2>

          <p>Hi ${data.recipientName},</p>

          <p>The following session has been cancelled by the ${data.cancelledBy}:</p>

          <div style="background-color: #FEF2F2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
            <p style="margin: 5px 0;"><strong>Subject:</strong> ${data.subject}</p>
            <p style="margin: 5px 0;"><strong>With:</strong> ${data.otherPartyName}</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${data.date}</p>
            <p style="margin: 5px 0;"><strong>Time:</strong> ${data.time}</p>
          </div>

          <p style="color: #5D6D7E; font-size: 14px;">If you have questions about refunds or cancellation policies, contact us at <a href="mailto:support@findgrinds.ie" style="color: #2D9B6E;">support@findgrinds.ie</a>.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.dashboardUrl}" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),
  sessionDisputeRaised: (data: {
    tutorName: string;
    studentName: string;
    subject: string;
    date: string;
    reason: string;
  }) => ({
    subject: `Session Dispute - ${data.subject} on ${data.date}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>${emailHead}</head>
        <body style="${bodyStyle}">
          ${emailHeaderCompact}

          <h2 style="color: #2C3E50;">Session Dispute Raised</h2>

          <p>Hi ${data.tutorName},</p>

          <p>A student has raised a dispute about one of your sessions. Please review the details below and respond with your side of the story.</p>

          <div style="background-color: #FEF2F2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
            <p style="margin: 5px 0;"><strong>Student:</strong> ${data.studentName}</p>
            <p style="margin: 5px 0;"><strong>Subject:</strong> ${data.subject}</p>
            <p style="margin: 5px 0;"><strong>Date:</strong> ${data.date}</p>
            <p style="margin: 5px 0;"><strong>Reason:</strong> ${data.reason}</p>
          </div>

          <p>You can respond to this dispute from your dashboard. Providing your perspective and any supporting evidence will help us resolve this fairly.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
          </div>

          ${EMAIL_FOOTER}
        </body>
      </html>
    `,
  }),
};

// Email service functions
export const emailService = {
  async sendWelcomeEmail(to: string, firstName: string, userType: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = userType === 'TUTOR'
        ? templates.welcomeTutor(firstName)
        : templates.welcome(firstName);

      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      if (error) {
        console.error('[Email] Failed to send welcome email:', error);
        return;
      }

      console.log(`[Email] Welcome email sent to ${to}`, data?.id);
    } catch (error) {
      console.error('[Email] Error sending welcome email:', error);
    }
  },

  async sendBookingConfirmation(
    studentEmail: string,
    tutorEmail: string,
    details: {
      studentName: string;
      tutorName: string;
      subject: string;
      date: string;
      time: string;
      price: string;
      tutorEarnings: string;
      sessionType?: 'VIDEO' | 'IN_PERSON' | 'GROUP';
      meetingLink?: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const studentTemplate = templates.bookingConfirmationStudent({
        studentName: details.studentName,
        tutorName: details.tutorName,
        subject: details.subject,
        date: details.date,
        time: details.time,
        price: details.price,
        sessionType: details.sessionType,
        meetingLink: details.meetingLink,
      });

      const tutorTemplate = templates.bookingConfirmationTutor({
        tutorName: details.tutorName,
        studentName: details.studentName,
        subject: details.subject,
        date: details.date,
        time: details.time,
        earnings: details.tutorEarnings,
        sessionType: details.sessionType,
        meetingLink: details.meetingLink,
      });

      await Promise.all([
        resend.emails.send({
          from: FROM_EMAIL,
          to: studentEmail,
          subject: studentTemplate.subject,
          html: studentTemplate.html,
        }),
        resend.emails.send({
          from: FROM_EMAIL,
          to: tutorEmail,
          subject: tutorTemplate.subject,
          html: tutorTemplate.html,
        }),
      ]);

      console.log(`[Email] Booking confirmations sent to ${studentEmail} and ${tutorEmail}`);
    } catch (error) {
      console.error('[Email] Error sending booking confirmation:', error);
    }
  },

  async sendSessionReminder(
    to: string,
    details: {
      name: string;
      tutorName: string;
      subject: string;
      date: string;
      time: string;
      zoomLink?: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.sessionReminder(details);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Session reminder sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending session reminder:', error);
    }
  },

  async sendGardaVettingApproved(to: string, firstName: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.gardaVettingApproved(firstName);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Garda vetting approved email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending garda vetting approved email:', error);
    }
  },

  async sendGardaVettingRejected(to: string, firstName: string, reason?: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.gardaVettingRejected(firstName, reason);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Garda vetting rejected email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending garda vetting rejected email:', error);
    }
  },

  // --- New service methods ---

  async sendPasswordResetEmail(to: string, firstName: string, resetLink: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.passwordReset(firstName, resetLink);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Password reset email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending password reset email:', error);
    }
  },

  async sendPasswordChangedEmail(to: string, firstName: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.passwordChanged(firstName);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Password changed email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending password changed email:', error);
    }
  },

  async sendAccountDeletedEmail(to: string, firstName: string) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.accountDeleted(firstName);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Account deleted email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending account deleted email:', error);
    }
  },

  async sendNewMessageNotification(
    to: string,
    details: {
      recipientName: string;
      senderName: string;
      messagePreview: string;
      conversationUrl: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.newMessageNotification(details);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] New message notification sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending new message notification:', error);
    }
  },

  async sendSubscriptionConfirmation(
    to: string,
    details: {
      firstName: string;
      tierName: string;
      price: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.subscriptionConfirmation(details);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Subscription confirmation sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending subscription confirmation:', error);
    }
  },

  async sendSessionCancelledEmail(
    to: string,
    details: {
      recipientName: string;
      otherPartyName: string;
      subject: string;
      date: string;
      time: string;
      cancelledBy: 'student' | 'tutor';
      dashboardUrl: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.sessionCancelled(details);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Session cancelled email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending session cancelled email:', error);
    }
  },

  async sendSessionDisputeRaisedEmail(
    to: string,
    details: {
      tutorName: string;
      studentName: string;
      subject: string;
      date: string;
      reason: string;
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      const template = templates.sessionDisputeRaised(details);

      await resend.emails.send({
        from: FROM_EMAIL,
        to,
        subject: template.subject,
        html: template.html,
      });

      console.log(`[Email] Session dispute raised email sent to ${to}`);
    } catch (error) {
      console.error('[Email] Error sending session dispute raised email:', error);
    }
  },
};

export default emailService;
