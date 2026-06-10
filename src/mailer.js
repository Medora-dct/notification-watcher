const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { buildFeedEmailHtml, buildTaskEmailHtml } = require('./emailTemplate');

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'eu-central-1' });

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;
const SES_FROM_NAME = process.env.SES_FROM_NAME || 'MEDORA Notification';
const APP_URL = process.env.APP_URL || 'https://qa.medoradct.com';
const SES_CONFIG_SET = process.env.SES_CONFIG_SET || 'medora-email-tracking';

function ts() { return new Date().toISOString(); }

async function sendEmail({ toEmail, subject, htmlBody, textBody, emailType }) {
  const params = {
    Source: `"${SES_FROM_NAME}" <${SES_FROM_EMAIL}>`,
    Destination: { ToAddresses: [toEmail] },
    ConfigurationSetName: SES_CONFIG_SET,
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Charset: 'UTF-8', Data: htmlBody },
        Text: { Charset: 'UTF-8', Data: textBody },
      },
    },
    Tags: [
      { Name: 'EmailType', Value: emailType },
      { Name: 'Environment', Value: process.env.APP_ENV || 'staging' },
    ],
  };
  const result = await sesClient.send(new SendEmailCommand(params));
  return result.MessageId;
}

async function sendFeedEmail(toEmail, firstName, feed, visitContext = {}) {
  const { message, module: moduleName } = feed;
  const messageId = await sendEmail({
    toEmail,
    subject: `MEDORA | New Update`,
    htmlBody: buildFeedEmailHtml(firstName, feed, visitContext),
    textBody: `Dear ${firstName},\n\nA new update has been posted for you on the MEDORA platform.\n\n${message}\n\nView it at: ${APP_URL}/notification`,
    emailType: 'feed-notification',
  });
  console.log(`[${ts()}] [Mailer] Feed email sent | to=${toEmail} | module=${moduleName} | messageId=${messageId}`);
}

async function sendTaskEmail(toEmail, firstName, task) {
  const { message, module: moduleName } = task;
  const messageId = await sendEmail({
    toEmail,
    subject: `[MEDORA] Action required: ${moduleName}`,
    htmlBody: buildTaskEmailHtml(firstName, task),
    textBody: `Dear ${firstName},\n\nA task requires your attention on the MEDORA platform.\n\n${message}\n\nView it at: ${APP_URL}/notification`,
    emailType: 'task-notification',
  });
  console.log(`[${ts()}] [Mailer] Task email sent | to=${toEmail} | module=${moduleName} | messageId=${messageId}`);
}

module.exports = { sendFeedEmail, sendTaskEmail };
