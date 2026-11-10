/**
 * Minimal RFC 5321 SMTP server for tests. Receives real messages sent by
 * nodemailer over TCP so the full e-mail path (config → transport → wire) is
 * exercised without an external mail provider.
 */
const net = require('node:net');

function decodeQuotedPrintable(text) {
  const softBreaksRemoved = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < softBreaksRemoved.length; i += 1) {
    const ch = softBreaksRemoved[i];
    const hex = softBreaksRemoved.slice(i + 1, i + 3);
    if (ch === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(ch, 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeBodies(raw) {
  const decoded = [decodeQuotedPrintable(raw)];
  // Also decode any base64 blocks (nodemailer may pick base64 for some parts).
  const base64Blocks = raw.match(/(?:^[A-Za-z0-9+/=]{40,}\r?\n)+/gm) || [];
  for (const block of base64Blocks) {
    decoded.push(Buffer.from(block.replace(/\s+/g, ''), 'base64').toString('utf8'));
  }
  return decoded.join('\n');
}

async function startSmtpServer({ rejectRecipients = false } = {}) {
  const messages = [];
  const waiters = [];
  const state = { rejectRecipients };

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    let envelope = { from: null, to: [] };
    const reply = (line) => socket.write(`${line}\r\n`);

    reply('220 jeweler-test-smtp ESMTP ready');

    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.length) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          const raw = buffer.slice(0, end).replace(/^\.\./gm, '.');
          buffer = buffer.slice(end + 5);
          inData = false;
          const message = { ...envelope, raw, text: decodeBodies(raw), receivedAt: new Date() };
          messages.push(message);
          envelope = { from: null, to: [] };
          reply('250 2.0.0 queued');
          for (const waiter of waiters.splice(0)) waiter();
          continue;
        }
        const lineEnd = buffer.indexOf('\r\n');
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        const command = line.slice(0, 4).toUpperCase();

        if (command === 'EHLO') {
          socket.write('250-jeweler-test-smtp\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
        } else if (command === 'HELO') {
          reply('250 jeweler-test-smtp');
        } else if (command === 'MAIL') {
          envelope.from = (line.match(/<([^>]*)>/) || [])[1] || null;
          reply('250 2.1.0 OK');
        } else if (command === 'RCPT') {
          if (state.rejectRecipients) {
            reply('550 5.1.1 Mailbox unavailable');
          } else {
            envelope.to.push((line.match(/<([^>]*)>/) || [])[1]);
            reply('250 2.1.5 OK');
          }
        } else if (command === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (command === 'RSET') {
          envelope = { from: null, to: [] };
          reply('250 OK');
        } else if (command === 'NOOP') {
          reply('250 OK');
        } else if (command === 'QUIT') {
          reply('221 Bye');
          socket.end();
        } else {
          reply('502 5.5.2 Command not implemented');
        }
      }
    });
    socket.on('error', () => {});
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    port: server.address().port,
    messages,
    setRejectRecipients(value) {
      state.rejectRecipients = value;
    },
    clear() {
      messages.length = 0;
    },
    async waitForMessage(predicate = () => true, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await new Promise((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 50);
        });
      }
      throw new Error('SMTP test server: expected message was not received');
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function extractResetToken(message) {
  const match = message.text.match(/reset-password\?token=([0-9a-f]{64})/);
  return match ? match[1] : null;
}

module.exports = { startSmtpServer, extractResetToken };
