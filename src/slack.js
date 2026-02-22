const https = require('https');
const http = require('http');
const { URL } = require('url');

async function sendSlack({ webhookUrl, message, title, channel, username, iconEmoji }) {
  if (!webhookUrl) return { status: 'skipped' };

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: title, emoji: true }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message }
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Repo:* <${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}|${process.env.GITHUB_REPOSITORY}> · *Run:* <${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}|#${process.env.GITHUB_RUN_NUMBER}>`
        }
      ]
    }
  ];

  const payload = {
    text: `${title}: ${message}`, // fallback for notifications
    blocks,
    ...(username && { username }),
    ...(iconEmoji && { icon_emoji: iconEmoji }),
    ...(channel && { channel })
  };

  try {
    await post(webhookUrl, payload);
    return { status: 'sent' };
  } catch (err) {
    console.error(`[notify-cascade] Slack error: ${err.message}`);
    return { status: 'failed', error: err.message };
  }
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = { sendSlack };
