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
    <p>We retain your information for as long as your account is active or as needed to provide you services, comply with legal obligations, resolve disputes, and enforce our agreements. If you delete your account (see below), we delete your personal data as described in this policy.</p>

    <h2>6. Your Rights and Choices</h2>
    <ul>
      <li><strong>Access and correction:</strong> You can access and update your profile and account information in the app settings.</li>
      <li><strong>Delete account:</strong> You may request deletion of your account at any time via <strong>Settings → Delete account</strong>. We will delete your personal data (e.g. username, email, profile, shop name). After deletion, you may sign up again with the same email or username.</li>
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

const TERMS_AND_CONDITIONS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Terms &amp; Conditions – WhapVibez</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; background: #f8f9fa; padding: 20px; }
    .container { max-width: 720px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
    h1 { font-size: 28px; margin-bottom: 8px; color: #111; }
    .updated { color: #666; font-size: 14px; margin-bottom: 24px; }
    h2 { font-size: 18px; margin-top: 28px; margin-bottom: 10px; color: #222; }
    h3 { font-size: 16px; margin-top: 18px; margin-bottom: 8px; color: #222; }
    p, li { margin-bottom: 10px; }
    ul { margin-left: 20px; }
    a { color: #DD3030; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .contact { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Terms &amp; Conditions</h1>
    <p class="updated">Last updated: January 2026</p>

    <p>Welcome to WhapVibez (&ldquo;WhapVibez,&rdquo; &ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;). These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the WhapVibez mobile application, website, marketplace, live streaming features, messaging, and any related services (collectively, the &ldquo;Services&rdquo;). By creating an account, accessing, or using our Services, you agree to be bound by these Terms.</p>

    <h2>1. Eligibility &amp; Accounts</h2>
    <p>To use WhapVibez you must:</p>
    <ul>
      <li>Be at least 13 years old (or the minimum age required in your country) and, where required, have consent from a parent or legal guardian.</li>
      <li>Be legally able to enter into a binding contract in your jurisdiction.</li>
      <li>Provide accurate and complete registration information and keep it up to date.</li>
    </ul>
    <p>You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must notify us immediately if you believe your account has been compromised.</p>

    <h2>2. Description of the Service</h2>
    <p>WhapVibez is a social platform that allows users to:</p>
    <ul>
      <li>Discover and share short-form videos and other content.</li>
      <li>Host and participate in live streams.</li>
      <li>Chat and interact with other users via messages and community features.</li>
      <li>Create and manage shops, list products, and complete purchases within an integrated marketplace.</li>
      <li>Send and receive gifts, tips, and other forms of digital support.</li>
    </ul>
    <p>We may update, improve, or remove features from time to time to enhance the overall experience.</p>

    <h2>3. User Content &amp; Intellectual Property</h2>
    <h3>3.1 Your content</h3>
    <p>You remain the owner of the content you create and share on WhapVibez, including videos, images, audio, captions, comments, messages, shop listings, product images, and other materials (&ldquo;User Content&rdquo;).</p>

    <h3>3.2 License you grant to WhapVibez</h3>
    <p>By uploading, posting, or otherwise making User Content available on or through the Services, you grant WhapVibez a worldwide, non-exclusive, royalty-free, transferable, and sublicensable license to host, store, use, reproduce, modify (for technical and formatting purposes), adapt, publish, translate, distribute, publicly perform, and publicly display such User Content in connection with operating, promoting, and improving the Services. You can end this license for specific content by deleting it from the app or deleting your account, subject to reasonable time for technical removal and any legal obligations.</p>

    <h3>3.3 Your responsibilities</h3>
    <p>You represent and warrant that:</p>
    <ul>
      <li>You have all necessary rights, licenses, and permissions to upload and share your User Content.</li>
      <li>Your User Content does not infringe or violate any third-party rights, including copyrights, trademarks, privacy, publicity, or other proprietary rights.</li>
      <li>Your User Content complies with these Terms and all applicable laws.</li>
    </ul>

    <h3>3.4 WhapVibez intellectual property</h3>
    <p>The WhapVibez name, logos, trademarks, service marks, design, user interface, software, and underlying technology are owned by or licensed to WhapVibez and are protected by intellectual property laws. You may not copy, modify, distribute, sell, lease, reverse engineer, or create derivative works based on any part of the Services except as expressly allowed by these Terms or with our written permission.</p>

    <h2>4. Community Guidelines &amp; Prohibited Conduct</h2>
    <p>To keep WhapVibez safe and enjoyable, you agree that you will not:</p>
    <ul>
      <li>Use the Services for any unlawful, harmful, or fraudulent purpose.</li>
      <li>Share content that is hateful, harassing, threatening, discriminatory, sexually explicit, or otherwise inappropriate.</li>
      <li>Share content that promotes self-harm, violence, terrorism, exploitation, or illegal activities.</li>
      <li>Post spam, scams, or misleading content, including fake offers or impersonating others.</li>
      <li>Upload viruses, malware, or other harmful code, or attempt to interfere with the security or operation of the Services.</li>
      <li>Attempt to access other users&rsquo; accounts or personal information without permission.</li>
      <li>Use automated scripts, bots, or scraping tools without our written permission.</li>
    </ul>
    <p>We may remove or restrict content or accounts that violate these guidelines or our policies, or as required by law.</p>

    <h2>5. Shops, Marketplace &amp; Fees</h2>
    <h3>5.1 Sellers &amp; creators</h3>
    <p>If you create a shop or otherwise sell products, services, or digital items through WhapVibez, you agree that:</p>
    <ul>
      <li>You are solely responsible for the accuracy of your listings, pricing, descriptions, and availability.</li>
      <li>You are responsible for fulfilling orders, shipping products (if applicable), handling returns and customer support related to your shop.</li>
      <li>You will comply with all applicable consumer, tax, and e-commerce laws.</li>
    </ul>

    <h3>5.2 Buyers</h3>
    <p>If you purchase items on WhapVibez, you acknowledge that your contract for purchase is primarily with the seller or creator, not WhapVibez. While we may provide tools to facilitate payments and dispute resolution, we are not the seller of most items listed by users on the marketplace.</p>

    <h3>5.3 Platform fees &amp; payouts</h3>
    <p>WhapVibez may charge platform or transaction fees, commissions, or service charges on earnings from gifts, subscriptions, sales, or other monetization features. Any applicable fee structure, payout schedule, minimum withdrawal thresholds, supported payout methods, and currencies (including TZS and others where supported) will be communicated in the app, in your creator or shop dashboard, or in specific feature terms. We may update these fees and payout rules from time to time.</p>
    <p>Payouts may depend on successful payment processing, fraud checks, chargebacks, and compliance reviews. We may temporarily hold or reverse payouts if we suspect fraudulent or abusive activity.</p>

    <h3>5.4 Taxes</h3>
    <p>You are responsible for any taxes (including income, VAT, or sales tax) arising from your use of the Services, including earnings from sales, gifts, or tips, unless we are legally required to collect and remit them on your behalf.</p>

    <h2>6. Virtual Items, Gifts &amp; In-App Balances</h2>
    <p>From time to time, WhapVibez may offer in-app virtual items, gifts, or credits. Unless expressly stated, these do not represent real-world currency, have no cash value outside the platform, and are non-refundable except where required by law. We may change, limit, or discontinue virtual items and related features at any time.</p>

    <h2>7. Payments &amp; Refunds</h2>
    <p>Payments processed through WhapVibez (for example, via cards, mobile money, or other methods) are handled by third-party payment providers. By completing a transaction, you agree to their terms and any applicable fees.</p>
    <p>Refund eligibility for purchases (including products, subscriptions, or digital items) will depend on the seller&rsquo;s policy, applicable law, and our platform rules. We may, at our discretion, assist with certain disputes but are not obligated to provide refunds where we are not the seller of the item.</p>

    <h2>8. Data &amp; Privacy</h2>
    <p>Your use of the Services is also governed by our <a href="/v1/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, which explains how we collect, use, and protect your information. By using WhapVibez, you agree to the practices described in the Privacy Policy.</p>

    <h2>9. Third-Party Services &amp; Links</h2>
    <p>The Services may integrate with or link to third-party services (e.g. payment providers, analytics, or social networks). We are not responsible for third-party content, terms, or privacy practices. Your use of any third-party service is solely between you and that provider.</p>

    <h2>10. Disclaimers</h2>
    <p>The Services are provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. To the fullest extent permitted by law, we disclaim all warranties, express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement, and any warranties arising out of course of dealing or usage of trade.</p>
    <p>We do not guarantee uninterrupted, secure, or error-free operation of the Services, nor do we guarantee that any content or information is accurate, complete, or up to date.</p>

    <h2>11. Limitation of Liability</h2>
    <p>To the maximum extent permitted by law, WhapVibez and its affiliates, directors, employees, and partners will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from:</p>
    <ul>
      <li>Your access to or use of (or inability to access or use) the Services;</li>
      <li>Any conduct or content of other users or third parties on the Services;</li>
      <li>Unauthorized access, use, or alteration of your transmissions or content.</li>
    </ul>
    <p>In all cases, our total liability for any claim arising out of or relating to the Services will be limited to the amount you have paid to us (if any) in the previous 12 months, or the minimum amount permitted under applicable law.</p>

    <h2>12. Indemnity</h2>
    <p>You agree to indemnify and hold harmless WhapVibez and its affiliates, directors, officers, employees, and partners from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or related to:</p>
    <ul>
      <li>Your use of the Services;</li>
      <li>Your User Content;</li>
      <li>Your violation of these Terms or any applicable law;</li>
      <li>Your violation of any rights of a third party.</li>
    </ul>

    <h2>13. Suspension &amp; Termination</h2>
    <p>We may suspend or terminate your access to the Services, with or without notice, if we reasonably believe that you have violated these Terms, our policies, or applicable law, or if we need to protect the platform, other users, or our legitimate interests.</p>
    <p>Upon termination, your right to use the Services will immediately cease, and we may delete or restrict access to your account and User Content, subject to legal obligations and our data retention policies.</p>

    <h2>14. Governing Law &amp; Disputes</h2>
    <p>These Terms are governed by the laws of the jurisdiction where WhapVibez is established, without regard to conflict of law principles. Any dispute arising out of or relating to these Terms or the Services will be subject to the exclusive jurisdiction of the courts in that jurisdiction, unless otherwise required by applicable law.</p>

    <h2>15. Changes to These Terms</h2>
    <p>We may update these Terms from time to time to reflect changes to our Services, legal requirements, or business practices. We will notify you of material changes by updating the &ldquo;Last updated&rdquo; date at the top, and, where appropriate, through in-app notifications, email, or other means. Your continued use of the Services after changes take effect means you accept the updated Terms.</p>

    <h2>16. Contact Us</h2>
    <p class="contact">If you have questions about these Terms or how WhapVibez works, you can contact us at:</p>
    <p><strong>Email (general support):</strong> <a href="mailto:support@whapvibez.com">support@whapvibez.com</a></p>
    <p><strong>Email (privacy &amp; data):</strong> <a href="mailto:privacy@whapvibez.com">privacy@whapvibez.com</a></p>
    <p>WhapVibez – Legal &amp; Support</p>
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
    <p>You can request that your WhapVibez account and associated data be deleted at any time. We will delete your information as requested.</p>

    <h2>Option 1: Delete in the app (recommended)</h2>
    <p>If you have the WhapVibez app installed:</p>
    <ul>
      <li>Open the app and sign in.</li>
      <li>Go to <strong>Profile → Settings</strong>.</li>
      <li>Tap <strong>Delete account</strong> and follow the confirmation.</li>
    </ul>
    <p>Your account and associated data will be deleted. You can later sign up again with the same email or username if you wish.</p>

    <h2>Option 2: Request by email</h2>
    <p>If you no longer have the app or prefer to request deletion by email, send a message from the email address associated with your account to:</p>
    <div class="card">
      <p class="email"><a href="mailto:privacy@whapvibez.com?subject=Delete%20my%20WhapVibez%20account">privacy@whapvibez.com</a></p>
      <p style="margin-top:8px;font-size:14px;color:#666;">Subject: Delete my WhapVibez account</p>
    </div>
    <p>Include the email address of the account you want deleted. We will process your request and delete your account and associated data in line with our <a href="/v1/legal/privacy-policy">Privacy Policy</a>.</p>

    <h2>What we do when you delete</h2>
    <ul>
      <li>We delete your profile (username, email, name, bio, photo, etc.) and shop data.</li>
      <li>We do not retain your personal data after deletion.</li>
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

  @Get('terms')
  @Header('Content-Type', 'text/html; charset=utf-8')
  terms(@Res() res: Response) {
    return res.status(200).send(TERMS_AND_CONDITIONS_HTML);
  }

  @Get('delete-account')
  @Header('Content-Type', 'text/html; charset=utf-8')
  deleteAccount(@Res() res: Response) {
    return res.status(200).send(DELETE_ACCOUNT_HTML);
  }
}
