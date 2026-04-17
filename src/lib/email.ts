import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: parseInt(process.env.SMTP_PORT || "1025"),
  secure: false,
});

function buildBrandedEmail({
  heading,
  body,
  ctaText,
  ctaUrl,
  footer,
}: {
  heading: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footer: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
      <div style="margin-bottom: 32px;">
        <span style="font-size: 20px; font-weight: 700; color: #121212; letter-spacing: -0.01em;">WK</span>
      </div>
      <h1 style="font-size: 24px; font-weight: 600; color: #121212; margin: 0 0 16px;">${heading}</h1>
      <div style="font-size: 15px; line-height: 1.6; color: #333;">${body}</div>
      <div style="margin: 24px 0;">
        <a href="${ctaUrl}" style="display: inline-block; padding: 12px 24px; background: #00A6D3; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px;">${ctaText}</a>
      </div>
      <p style="font-size: 13px; color: #666; margin-top: 32px;">${footer}</p>
    </div>
  `;
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "Reset your password — WeKnow",
    html: buildBrandedEmail({
      heading: "Reset your password",
      body: "<p>Click below to reset your password:</p>",
      ctaText: "Reset password",
      ctaUrl: resetUrl,
      footer: "This link expires in 1 hour. If you didn't request this, ignore this email.",
    }),
  });
}

export async function sendInviteEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "You're invited to WeKnow — Set your password",
    html: buildBrandedEmail({
      heading: "You're invited to WeKnow",
      body: "<p>You've been invited to the WeKnow Command Centre.</p><p>Click below to set your password and get started:</p>",
      ctaText: "Set your password",
      ctaUrl: resetUrl,
      footer: "This link expires in 1 hour.",
    }),
  });
}

export async function sendExternalInviteEmail({
  to,
  setPasswordUrl,
}: {
  to: string;
  setPasswordUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "Welcome to WeKnow Analytics — Set your password",
    html: buildBrandedEmail({
      heading: "Welcome to WeKnow Analytics",
      body: "<p>You've been invited to the WeKnow Analytics Portal, where you can view performance analytics for your locations.</p><p>Click below to set your password and access your dashboard:</p>",
      ctaText: "Set your password",
      ctaUrl: setPasswordUrl,
      footer: "Once you've set your password, you can sign in at any time to view your analytics.",
    }),
  });
}
