import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: parseInt(process.env.SMTP_PORT || "1025"),
  secure: false,
  // For production: configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
});

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
    html: `<p>Click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
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
    html: `<p>You've been invited to the WeKnow Kiosk Management platform.</p><p>Click below to set your password and get started:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
}
