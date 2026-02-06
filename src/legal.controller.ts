import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';

const PRIVACY_POLICY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Privacy Policy – WhapVibez</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; padding: 20px; }
    .container { max-width: 720px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    h1 { font-size: 28px; margin-bottom: 8px; color: #111; }
    .updated { color: #666; font-size: 14px; margin-bottom: 24px; }
    h2 { font-size: 18px; margin-top: 28px; margin-bottom: 10px; color: #222; }
    p, li { margin-bottom: 10px; }
    ul { margin-left: 20px; }
    a { color: #DD3030; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .contact { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: January 2026</p>

    <p>WhapVibez (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) is committed to protecting your privacy. This Privacy Policy explains how we collect, use, store, and protect your information when you use our mobile application and related services.</p>

    <h2>1. Information We Collect</h2>
    <p>We collect information in the following ways:</p>
    <ul>
      <li><strong>Account information:</strong> When you register, we collect your email address, username, full name, and password. You may also provide a profile photo, bio, phone number, website, location, date of birth, gender, and category.</li>
      <li><strong>User-generated content:</strong> Videos, photos, captions, comments, likes, reposts, and messages you create or send through the app.</li>
      <li><strong>Camera and microphone:</strong> We access your device&rsquo;s camera and microphone only when you choose to record or stream video or audio. We do not collect or store raw camera or microphone data beyond the content you choose to upload or broadcast.</li>
      <li><strong>Location:</strong> If you enable location services, we may collect your location to tag posts or improve services. You can disable this in your device or app settings.</li>
      <li><strong>Shop and payments:</strong> If you use our marketplace, we collect shop details (name, description, logo), product listings, order and payment-related data, and payout information as needed to process transactions.</li>
      <li><strong>Messaging:</strong> Messages you send and receive, and related metadata (e.g. read receipts, online status if you enable them), to provide real-time chat and notifications.</li>
      <li><strong>Device and usage:</strong> Device type, operating system, app version, and usage data (e.g. how you use the app) to improve services and fix issues. We may use analytics and crash-reporting tools.</li>
      <li><strong>Push notifications:</strong> We store a push token (e.g. FCM) to send you notifications you have agreed to receive.</li>
    </ul>

    <h2>2. How We Use Your Information</h2>
    <p>We use the information we collect to:</p>
    <ul>
      <li>Provide, maintain, and improve the app (feed, profiles, posts, live streaming, messaging, shop, and notifications).</li>
      <li>Create and manage your account and authenticate you.</li>
      <li>Process payments and fulfill orders in the marketplace.</li>
      <li>Send you service-related and, where allowed, marketing communications and push notifications.</li>
      <li>Enforce our terms, prevent fraud and abuse, and comply with legal obligations.</li>
      <li>Analyze usage to improve the product and develop new features.</li>
    </ul>

    <h2>3. Data Storage and Security</h2>
    <p>Your data is stored on secure servers (including cloud providers we use for hosting and storage). We use industry-standard technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. No method of transmission or storage is 100% secure; we cannot guarantee absolute security.</p>

    <h2>4. Sharing of Information</h2>
    <p>We do not sell your personal information. We may share your information only in these cases:</p>
    <ul>
      <li><strong>Service providers:</strong> With vendors who help us operate the app (e.g. hosting, analytics, payment processing, push notifications, live streaming). They are contractually required to protect your data and use it only for the services they provide to us.</li>
      <li><strong>Other users:</strong> Your profile and public content (e.g. username, profile photo, posts you make public) are visible according to your privacy and app settings.</li>
      <li><strong>Legal:</strong> When required by law, court order, or government request, or to protect our rights, safety, or property.</li>
      <li><strong>Business transfer:</strong> In connection with a merger, sale, or acquisition, subject to the same privacy commitments.</li>
    </ul>

    <h2>5. Data Retention</h2>
    <p>We retain your information for as long as your account is active or as needed to provide you services, comply with legal obligations, resolve disputes, and enforce our agreements. If you delete your account (see below), we anonymize your personal data while retaining non-identifying records where required for audit or legal purposes.</p>

    <h2>6. Your Rights and Choices</h2>
    <ul>
      <li><strong>Access and correction:</strong> You can access and update your profile and account information in the app settings.</li>
      <li><strong>Delete account:</strong> You may request deletion of your account at any time via <strong>Settings → Delete account</strong>. We will anonymize your personal data (e.g. username, email, profile, shop name) so you are no longer identifiable, while we may retain anonymized records for audit and legal compliance. After anonymization, you may sign up again with the same email or username.</li>
      <li><strong>Privacy settings:</strong> You can control who can message you, see your online status, and view your content using in-app privacy settings.</li>
      <li><strong>Notifications:</strong> You can manage push and in-app notification preferences in your device and app settings.</li>
      <li><strong>Location:</strong> You can disable location access in your device settings or when the app prompts you.</li>
    </ul>

    <h2>7. Children&rsquo;s Privacy</h2>
    <p>Our services are not directed to children under 13 (or the applicable age in your country). We do not knowingly collect personal information from children. If you believe we have collected such information, please contact us and we will delete it promptly.</p>

    <h2>8. International Transfers</h2>
    <p>Your information may be processed in countries other than your own. We ensure appropriate safeguards are in place so that your data remains protected in line with this policy and applicable law.</p>

    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy in the app or via email/notification where appropriate. The &ldquo;Last updated&rdquo; date at the top indicates when the policy was last revised. Continued use of the app after changes constitutes acceptance of the updated policy.</p>

    <h2>10. Contact Us</h2>
    <p class="contact">If you have questions about this Privacy Policy or our data practices, please contact us at:</p>
    <p><strong>Email:</strong> <a href="mailto:privacy@whapvibez.com">privacy@whapvibez.com</a></p>
    <p>WhapVibez – Privacy inquiries</p>
  </div>
</body>
</html>`;

const DELETE_ACCOUNT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Request account &amp; data deletion – WhapVibez</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; padding: 20px; }
    .container { max-width: 640px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    h1 { font-size: 24px; margin-bottom: 8px; color: #111; }
    h2 { font-size: 17px; margin-top: 24px; margin-bottom: 8px; color: #222; }
    p, li { margin-bottom: 10px; }
    ul { margin-left: 20px; }
    a { color: #DD3030; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .card { background: #f8f9fa; border-radius: 10px; padding: 16px; margin: 16px 0; }
    .email { font-weight: 600; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Request account &amp; data deletion</h1>
    <p>You can request that your WhapVibez account and associated data be deleted at any time. We process deletions by anonymizing your personal data (we do not retain identifiable information; we may keep anonymized records for audit and legal compliance).</p>

    <h2>Option 1: Delete in the app (recommended)</h2>
    <p>If you have the WhapVibez app installed:</p>
    <ul>
      <li>Open the app and sign in.</li>
      <li>Go to <strong>Profile → Settings</strong>.</li>
      <li>Tap <strong>Delete account</strong> and follow the confirmation.</li>
    </ul>
    <p>Your account and associated data will be anonymized immediately. You can later sign up again with the same email or username if you wish.</p>

    <h2>Option 2: Request by email</h2>
    <p>If you no longer have the app or prefer to request deletion by email, send a message from the email address associated with your account to:</p>
    <div class="card">
      <p class="email"><a href="mailto:privacy@whapvibez.com?subject=Delete%20my%20WhapVibez%20account">privacy@whapvibez.com</a></p>
      <p style="margin-top:8px;font-size:14px;color:#666;">Subject: Delete my WhapVibez account</p>
    </div>
    <p>Include the email address of the account you want deleted. We will process your request and anonymize your account and associated data in line with our <a href="/v1/legal/privacy-policy">Privacy Policy</a>.</p>

    <h2>What we do when you delete</h2>
    <ul>
      <li>We anonymize your profile (username, email, name, bio, photo, etc.) and shop data so you are no longer identifiable.</li>
      <li>We do not retain your personal data; anonymized records may be kept only where required for audit or law.</li>
      <li>After deletion, you may create a new account with the same email or username.</li>
    </ul>
    <p style="margin-top:24px;">For more details, see our <a href="/v1/legal/privacy-policy">Privacy Policy</a>.</p>
  </div>
</body>
</html>`;

@Controller('legal')
export class LegalController {
  @Get('privacy-policy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacyPolicy(@Res() res: Response) {
    return res.status(200).send(PRIVACY_POLICY_HTML);
  }

  @Get('delete-account')
  @Header('Content-Type', 'text/html; charset=utf-8')
  deleteAccount(@Res() res: Response) {
    return res.status(200).send(DELETE_ACCOUNT_HTML);
  }
}
