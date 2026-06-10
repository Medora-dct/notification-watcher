const jwt = require('jsonwebtoken');

const APP_URL = process.env.APP_URL || 'https://qa.medoradct.com';
const LAMBDA_URL = process.env.LAMBDA_URL;
const JWT_SECRET = process.env.JWT_SECRET;

function generateUnsubscribeUrl(userId) {
  const token = jwt.sign({ userId: userId.toString() }, JWT_SECRET, { expiresIn: '30d' });
  return `${LAMBDA_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function smartCapitalize(str) {
  if (!str) return str;
  return str.replace(/\w+/g, (word) => {
    if (word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// ─── Shared layout wrapper ────────────────────────────────────────────────────
// All emails share this outer shell. Pass in the inner content block.
function wrapLayout({ firstName, innerContent, unsubscribeUrl, showUnsubscribe = true }) {
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>MEDORA – Notification</title>
  <style>
    @media only screen and (max-width: 600px) {
      .main-container { width: 100% !important; padding: 10px !important; }
      .content-padding { padding: 20px !important; }
      .cta-button { width: 100% !important; display: block !important; box-sizing: border-box; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef2f6;font-family:'DM Sans',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#eef2f6;">
    <tr>
      <td align="center" style="padding:20px 0;">
        <table class="main-container" border="0" cellpadding="0" cellspacing="0" width="100%"
          style="max-width:580px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dce4ed;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

          <!-- Logo -->
          <tr>
            <td align="right" style="background-color:#ffffff;padding:20px 32px;border-bottom:2px solid #0b6b5d;">
              <img src="https://homenurse4u.com/medoraa/Medora_Black.svg" alt="Medora" height="28"
                style="display:inline-block;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>

          <!-- Dynamic inner content -->
          ${innerContent}

          <!-- Support -->
          <tr>
            <td class="content-padding" style="padding:20px 32px;border-top:1px solid #dce4ed;font-size:13px;color:#4a637a;line-height:1.6;">
              Need help? Contact your assigned MEDORA trainer or reach our support team at
              <a href="mailto:admin@medoradct.com" style="color:#0b6b5d;text-decoration:none;font-weight:500;">admin@medoradct.com</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="content-padding" style="background-color:#f5f8fa;border-top:1px solid #dce4ed;padding:20px 32px;">
              <table width="100%" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:#9db3c5;line-height:1.4;">Copyright &copy; ${year} HomeNurse4U.<br>All rights reserved.</td>
                  <td align="right" style="vertical-align:middle;">
                    <a href="https://homenurse4u.com/privacy-policy" style="font-size:12px;color:#7a92a8;text-decoration:none;">Privacy policy</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Unsubscribe (feeds emails only) -->
          ${showUnsubscribe ? `
          <tr>
            <td align="center" style="padding:16px 32px;border-top:1px solid #dce4ed;">
              <p style="font-size:12px;color:#9db3c5;margin:0;">
                Don't want these emails?
                <a href="${unsubscribeUrl}" style="color:#7a92a8;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>` : ''}

        </table>

        <!-- Legal -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;">
          <tr>
            <td style="padding:20px 10px;">
              <p style="text-align:left;font-size:11px;color:#9db3c5;margin:0 0 8px 0;">
                This is an automated message. Please do not reply directly to this email.
              </p>
              <p style="text-align:left;font-size:11px;color:#9db3c5;margin:0;line-height:1.6;">
                This e-mail may contain confidential, proprietary, or protected information - including protected health information -
                that is meant to be viewed only by the intended recipient or company. Any unauthorized review, use, copying, downloading
                or disclosure is strictly prohibited. If this e-mail is not intended for you, or if you have received this e-mail in error,
                please notify the sender immediately. Do not forward it to any further recipients and permanently delete this e-mail.
                If you have questions or concerns, please see our privacy policy on <a href="https://homenurse4u.com/privacy-policy" style="color:#9db3c5;text-decoration:underline;">homenurse4u.com</a>.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Feed notification email ──────────────────────────────────────────────────
function buildFeedEmailHtml(firstName, feed, visitContext = {}) {
  const { message, module: moduleName, subModule } = feed;
  const { protocolId, profileId } = visitContext;
  const notifUrl = `${APP_URL}/notification`;
  const unsubscribeUrl = generateUnsubscribeUrl(feed.userId);

  const innerContent = `
    <!-- Header badge -->
    <tr>
      <td class="content-padding" style="padding:32px 32px 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="42" style="vertical-align:top;">
              <div style="width:42px;height:42px;background-color:#e6f4f1;border-radius:10px;text-align:center;">
                <img src="https://cdn-icons-png.flaticon.com/512/3602/3602145.png" width="20" height="20"
                  style="margin-top:11px;filter:invert(31%) sepia(19%) saturate(1209%) hue-rotate(124deg) brightness(93%) contrast(93%);" alt="icon" />
              </div>
            </td>
            <td style="padding-left:14px;">
              <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#7a92a8;font-weight:500;margin:0 0 3px 0;">New Notification</p>
              <p style="font-size:17px;font-weight:600;color:#0f1f2e;margin:0;line-height:1.2;">You have a new update on MEDORA platform</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td class="content-padding" style="padding:24px 32px;">
        <p style="font-size:15px;color:#2d4558;line-height:1.7;margin:0 0 12px 0;">
          Dear <strong style="color:#0f1f2e;">${firstName}</strong>,
        </p>
        <p style="font-size:15px;color:#4a637a;line-height:1.7;margin:0 0 24px 0;">
          A new update has been posted for you on the MEDORA platform. Please review the details at your earliest convenience.
        </p>

        <div style="background-color:#f5f8fa;border:1px solid #dce4ed;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#7a92a8;font-weight:500;margin:0 0 6px 0;">Notification summary</p>
          <p style="font-size:15px;font-weight:600;color:#0f1f2e;margin:0 0 14px 0;">${smartCapitalize(message)}</p>
          <div style="height:1px;background-color:#dce4ed;margin:0 0 14px 0;"></div>
          <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:13px;color:#4a637a;padding-bottom:6px;">
                <strong style="color:#0f1f2e;">Module:</strong> ${moduleName}${subModule ? ' &nbsp;·&nbsp; ' + subModule : ''}
              </td>
            </tr>
            ${protocolId ? `<tr>
              <td style="font-size:13px;color:#4a637a;padding-bottom:6px;">
                <strong style="color:#0f1f2e;">Protocol:</strong> ${protocolId}
              </td>
            </tr>` : ''}
            ${profileId ? `<tr>
              <td style="font-size:13px;color:#4a637a;padding-bottom:6px;">
                <strong style="color:#0f1f2e;">Patient ID:</strong> ${profileId}
              </td>
            </tr>` : ''}
            <tr>
              <td style="padding-top:8px;">
                <table border="0" cellpadding="0" cellspacing="0">
                  <tr>
                    <td><div style="width:8px;height:8px;border-radius:50%;background-color:#0b6b5d;"></div></td>
                    <td style="padding-left:8px;font-size:13px;color:#0b6b5d;font-weight:500;">Follow the link below to take action</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom:10px;">
          <a href="${notifUrl}" class="cta-button"
             style="display:inline-block;background-color:#0b6b5d;color:#ffffff;text-align:center;text-decoration:none;padding:13px 40px;border-radius:9px;font-size:14px;font-weight:600;letter-spacing:0.02em;">
            View Notification
          </a>
        </div>
      </td>
    </tr>`;

  return wrapLayout({ firstName, innerContent, unsubscribeUrl, showUnsubscribe: true });
}

// ─── Task activation email ────────────────────────────────────────────────────
function buildTaskEmailHtml(firstName, task) {
  const { message, module: moduleName, role, name: actorName } = task;
  const notifUrl = `${APP_URL}/notification`;

  const innerContent = `
    <!-- Header badge -->
    <tr>
      <td class="content-padding" style="padding:32px 32px 0;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="42" style="vertical-align:top;">
              <div style="width:42px;height:42px;background-color:#fff4e6;border-radius:10px;text-align:center;">
                <img src="https://cdn-icons-png.flaticon.com/512/1077/1077114.png" width="20" height="20"
                  style="margin-top:11px;filter:invert(60%) sepia(80%) saturate(500%) hue-rotate(5deg) brightness(100%) contrast(95%);" alt="task icon" />
              </div>
            </td>
            <td style="padding-left:14px;">
              <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#7a92a8;font-weight:500;margin:0 0 3px 0;">Action Required</p>
              <p style="font-size:17px;font-weight:600;color:#0f1f2e;margin:0;line-height:1.2;">You have a new task on MEDORA platform</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td class="content-padding" style="padding:24px 32px;">
        <p style="font-size:15px;color:#2d4558;line-height:1.7;margin:0 0 12px 0;">
          Dear <strong style="color:#0f1f2e;">${firstName}</strong>,
        </p>
        <p style="font-size:15px;color:#4a637a;line-height:1.7;margin:0 0 24px 0;">
          A task has been assigned to you on the MEDORA platform that requires your attention.
        </p>

        <div style="background-color:#fff8f0;border:1px solid #fde8c8;border-radius:10px;padding:20px 24px;margin-bottom:28px;">
          <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.07em;color:#7a92a8;font-weight:500;margin:0 0 6px 0;">Task details</p>
          <p style="font-size:15px;font-weight:600;color:#0f1f2e;margin:0 0 14px 0;">${message}</p>
          <div style="height:1px;background-color:#fde8c8;margin:0 0 14px 0;"></div>
          <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size:13px;color:#7a92a8;padding-bottom:4px;">
                <strong style="color:#4a637a;">Module:</strong> ${moduleName || 'N/A'}
              </td>
            </tr>
          </table>
        </div>

        <div style="margin-bottom:10px;">
          <a href="${notifUrl}" class="cta-button"
             style="display:inline-block;background-color:#0b6b5d;color:#ffffff;text-align:center;text-decoration:none;padding:13px 40px;border-radius:9px;font-size:14px;font-weight:600;letter-spacing:0.02em;">
            View Task
          </a>
        </div>
      </td>
    </tr>`;

  // No unsubscribe for task emails (as per requirement)
  return wrapLayout({ firstName, innerContent, unsubscribeUrl: null, showUnsubscribe: false });
}

module.exports = { buildFeedEmailHtml, buildTaskEmailHtml };
