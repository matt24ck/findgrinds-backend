import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = 'FindGrinds <noreply@findgrinds.ie>';

// Email templates
const templates = {
  welcome: (firstName: string) => ({
    subject: 'Welcome to FindGrinds!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
            <p style="color: #5D6D7E; margin: 5px 0 0 0;">Find the Right Grinds Tutor</p>
          </div>

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

          <p style="color: #5D6D7E; font-size: 14px;">If you have any questions, just reply to this email - we're here to help!</p>

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
        </body>
      </html>
    `,
  }),

  welcomeTutor: (firstName: string) => ({
    subject: 'Welcome to FindGrinds - Start Teaching Today!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
            <p style="color: #5D6D7E; margin: 5px 0 0 0;">Find the Right Grinds Tutor</p>
          </div>

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
            <p style="margin: 0; font-size: 14px;"><strong>Tip:</strong> Tutors with verified Garda vetting and complete profiles get 3x more bookings!</p>
          </div>

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
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
  }) => {
    const sessionTypeLabel = data.sessionType === 'IN_PERSON' ? 'In-Person Session' :
      data.sessionType === 'GROUP' ? 'Group Class' : '1-on-1 Video Session';

    const sessionTypeNote = data.sessionType === 'IN_PERSON'
      ? `<p>Your tutor will contact you to arrange the meeting location.</p>`
      : data.sessionType === 'GROUP'
      ? `<p>You'll receive details about the group class location and other participants before your session.</p>`
      : `<p>You'll receive a video call link before your session.</p>`;

    return {
      subject: `Booking Confirmed - ${data.subject} with ${data.tutorName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
            </div>

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

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://findgrinds.ie/dashboard/student" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View My Sessions</a>
            </div>

            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

            <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
              FindGrinds | Dublin, Ireland<br>
              <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
            </p>
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
  }) => {
    const sessionTypeLabel = data.sessionType === 'IN_PERSON' ? 'In-Person Session' :
      data.sessionType === 'GROUP' ? 'Group Class' : '1-on-1 Video Session';

    const sessionTypeNote = data.sessionType === 'IN_PERSON'
      ? `<p style="margin-top: 15px;"><strong>Note:</strong> Please contact the student to arrange the meeting location.</p>`
      : data.sessionType === 'GROUP'
      ? `<p style="margin-top: 15px;"><strong>Note:</strong> This is a group class. Please send the class details to the student.</p>`
      : '';

    return {
      subject: `New Booking - ${data.subject} with ${data.studentName}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
            </div>

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

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View My Schedule</a>
            </div>

            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

            <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
              FindGrinds | Dublin, Ireland<br>
              <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
            </p>
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
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
          </div>

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

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
        </body>
      </html>
    `,
  }),

  gardaVettingApproved: (firstName: string) => ({
    subject: 'Your Garda Vetting has been verified!',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
          </div>

          <div style="text-align: center; margin: 20px 0;">
            <div style="display: inline-block; background-color: #D1FAE5; border-radius: 50%; padding: 20px;">
              <span style="font-size: 40px;">✓</span>
            </div>
          </div>

          <h2 style="color: #2C3E50; text-align: center;">Garda Vetting Verified!</h2>

          <p>Hi ${firstName},</p>

          <p>Great news! Your Garda vetting document has been verified. Your profile now displays the verified badge, which helps build trust with students and parents.</p>

          <div style="background-color: #F0F7F4; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <p style="margin: 0; color: #2D9B6E; font-weight: 600;">Your profile is now Garda Vetted ✓</p>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Your Profile</a>
          </div>

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
        </body>
      </html>
    `,
  }),

  gardaVettingRejected: (firstName: string, reason?: string) => ({
    subject: 'Garda Vetting verification update',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #2C3E50; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2D9B6E; margin: 0;">FindGrinds</h1>
          </div>

          <h2 style="color: #2C3E50;">Garda Vetting Update</h2>

          <p>Hi ${firstName},</p>

          <p>Unfortunately, we were unable to verify the Garda vetting document you uploaded.</p>

          ${reason ? `
          <div style="background-color: #FEF2F2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #EF4444;">
            <p style="margin: 0;"><strong>Reason:</strong> ${reason}</p>
          </div>
          ` : ''}

          <p>Please upload a clear, valid Garda vetting certificate and try again. If you believe this is an error, please contact us.</p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://findgrinds.ie/dashboard/tutor/verification" style="display: inline-block; background-color: #2D9B6E; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upload New Document</a>
          </div>

          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">

          <p style="color: #9CA3AF; font-size: 12px; text-align: center;">
            FindGrinds | Dublin, Ireland<br>
            <a href="https://findgrinds.ie" style="color: #2D9B6E;">findgrinds.ie</a>
          </p>
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
    }
  ) {
    if (!process.env.RESEND_API_KEY) {
      console.log('[Email] Skipping email - RESEND_API_KEY not configured');
      return;
    }

    try {
      // Send to student
      const studentTemplate = templates.bookingConfirmationStudent({
        studentName: details.studentName,
        tutorName: details.tutorName,
        subject: details.subject,
        date: details.date,
        time: details.time,
        price: details.price,
        sessionType: details.sessionType,
      });

      // Send to tutor
      const tutorTemplate = templates.bookingConfirmationTutor({
        tutorName: details.tutorName,
        studentName: details.studentName,
        subject: details.subject,
        date: details.date,
        time: details.time,
        earnings: details.tutorEarnings,
        sessionType: details.sessionType,
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
};

export default emailService;
