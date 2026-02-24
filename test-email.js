/**
 * Simple Email Test Script
 * Tests SMTP configuration by sending a test email
 * 
 * Usage: node test-email.js
 */

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Try to load .env file manually if dotenv is not available
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not installed, try to parse .env manually
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8');
      envFile.split('\n').forEach(line => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    }
  } catch (err) {
    console.warn('⚠️  Could not load .env file. Using defaults or environment variables.');
  }
}

// Get SMTP settings from environment
const smtpHost = process.env.SMTP_HOST || 'server313.web-hosting.com';
const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
const smtpUser = process.env.SMTP_USER || process.env.SMTP_FROM_EMAIL || 'no-reply@whapvibez.com';
const smtpPass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_FROM_EMAIL || smtpUser;
const smtpFromName = process.env.SMTP_FROM_NAME || 'WhapVibez';

// Test email recipient
const testEmail = 'uriohalvin@gmail.com';

console.log('📧 Email Test Script');
console.log('==================');
console.log(`SMTP Host: ${smtpHost}`);
console.log(`SMTP Port: ${smtpPort}`);
console.log(`SMTP User: ${smtpUser}`);
console.log(`From: ${smtpFromName} <${smtpFrom}>`);
console.log(`To: ${testEmail}`);
console.log('');

// Validate configuration
if (!smtpHost || smtpHost === 'serrr') {
  console.error('❌ Error: SMTP_HOST is not configured correctly');
  console.error('   Current value:', smtpHost);
  console.error('   Please set SMTP_HOST in .env file');
  process.exit(1);
}

if (!smtpPass) {
  console.error('❌ Error: SMTP_PASS or SMTP_PASSWORD is not set');
  process.exit(1);
}

// Create transporter
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465, // true for 465, false for other ports
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  // Add debug and logger for troubleshooting
  debug: true,
  logger: true,
});

// Test email content
const mailOptions = {
  from: `${smtpFromName} <${smtpFrom}>`,
  to: testEmail,
  subject: 'WhapVibez - Email Test',
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #dd3030 0%, #fe6464 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { color: #fff; margin: 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .otp-box { background: linear-gradient(135deg, #dd3030 0%, #fe6464 100%); padding: 20px; border-radius: 10px; text-align: center; margin: 20px 0; }
        .otp-code { font-size: 36px; font-weight: bold; color: #fff; letter-spacing: 5px; font-family: monospace; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>WhapVibez</h1>
        </div>
        <div class="content">
          <h2>Email Test Successful! ✅</h2>
          <p>This is a test email from WhapVibez to verify SMTP configuration.</p>
          
          <div class="otp-box">
            <p style="color: #fff; margin: 0 0 10px 0; font-size: 14px;">TEST CODE</p>
            <div class="otp-code">123456</div>
          </div>
          
          <p><strong>SMTP Configuration:</strong></p>
          <ul>
            <li>Host: ${smtpHost}</li>
            <li>Port: ${smtpPort}</li>
            <li>User: ${smtpUser}</li>
            <li>From: ${smtpFrom}</li>
          </ul>
          
          <p>If you received this email, your SMTP configuration is working correctly!</p>
        </div>
        <div class="footer">
          <p>© 2026 WhapVibez. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
  text: `
WhapVibez - Email Test

This is a test email from WhapVibez to verify SMTP configuration.

TEST CODE: 123456

SMTP Configuration:
- Host: ${smtpHost}
- Port: ${smtpPort}
- User: ${smtpUser}
- From: ${smtpFrom}

If you received this email, your SMTP configuration is working correctly!

© 2026 WhapVibez. All rights reserved.
  `,
};

// Send email
console.log('Sending test email...');
console.log('');

transporter.sendMail(mailOptions)
  .then((info) => {
    console.log('✅ Email sent successfully!');
    console.log('');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('');
    console.log(`📬 Check ${testEmail} inbox (and spam folder)`);
    console.log('');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error sending email:');
    console.error('');
    console.error('Error details:');
    console.error(error);
    console.error('');
    
    // Common error messages and solutions
    if (error.code === 'EAUTH') {
      console.error('🔧 Solution: Check SMTP_USER and SMTP_PASS credentials');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('🔧 Solution: Check SMTP_HOST and SMTP_PORT');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('🔧 Solution: SMTP server is not responding. Check host/port');
    } else if (error.message && error.message.includes('authentication')) {
      console.error('🔧 Solution: SMTP authentication failed. Verify username/password');
    }
    
    console.error('');
    process.exit(1);
  });
