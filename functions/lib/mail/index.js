/**
 * Simple mail abstraction for Workers.
 * Supports a no-op console logger (default) and a SendGrid-compatible sender.
 */

const DEFAULT_FROM = 'no-reply@ncd.local';

function isTruthy(value) {
  return value === true || value === 'true' || value === '1';
}

export function createMailClient(env, options = {}) {
  const provider = options.provider || env?.MAIL_PROVIDER || 'log';
  if (provider === 'sendgrid') {
    return sendgridClient({
      apiKey: env?.SENDGRID_API_KEY,
      defaultFrom: options.defaultFrom || env?.MAIL_DEFAULT_FROM || DEFAULT_FROM,
    });
  }
  return logClient({
    defaultFrom: options.defaultFrom || env?.MAIL_DEFAULT_FROM || DEFAULT_FROM,
    enabled: !('MAIL_LOGGER_DISABLED' in env) || !isTruthy(env.MAIL_LOGGER_DISABLED),
  });
}

function logClient({ defaultFrom, enabled }) {
  return {
    async send({ to, subject, text, html, from = defaultFrom, headers = {} }) {
      if (!enabled) return { ok: true, provider: 'log', skipped: true };
      console.log('[mail:log]', JSON.stringify({ to, subject, from, headers, text, html }, null, 2));
      return { ok: true, provider: 'log' };
    },
  };
}

function sendgridClient({ apiKey, defaultFrom }) {
  if (!apiKey) {
    console.warn('[mail] SENDGRID_API_KEY is not set; falling back to log');
    return logClient({ defaultFrom, enabled: true });
  }

  const endpoint = 'https://api.sendgrid.com/v3/mail/send';

  return {
    async send({ to, subject, text, html, from = defaultFrom, headers = {} }) {
      if (!to) throw new Error('Mail send requires `to`');
      const personalization = Array.isArray(to)
        ? to.map((item) => addressObject(item))
        : [addressObject(to)];

      const payload = {
        personalizations: [{ to: personalization }],
        from: addressObject(from),
        subject: subject || '',
        content: buildContent({ text, html }),
        headers,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const bodyText = await res.text();
        throw new Error(`SendGrid error ${res.status}: ${bodyText}`);
      }
      return { ok: true, provider: 'sendgrid' };
    },
  };
}

function addressObject(value) {
  if (!value) throw new Error('Invalid email address');
  if (typeof value === 'string') {
    return { email: value };
  }
  if (typeof value === 'object' && value.email) {
    const obj = { email: value.email };
    if (value.name) obj.name = value.name;
    return obj;
  }
  throw new Error('Invalid email address object');
}

function buildContent({ text, html }) {
  const content = [];
  if (html) {
    content.push({ type: 'text/html', value: html });
  }
  if (text || content.length === 0) {
    content.push({ type: 'text/plain', value: text || '' });
  }
  return content;
}
