/**
 * IMAP 邮件获取服务
 * 通过 IMAP 协议连接 QQ 邮箱，获取最近邮件列表
 * 支持 MIME 编码解码 (解决主题乱码问题)
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');

/**
 * 获取 QQ 邮箱最近邮件
 * @param {Object} config - IMAP 连接配置 { host, port, user, password, tls, limit }
 * @returns {Promise<Array>} 邮件列表
 */
function fetchEmailsViaImap(config) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      host: config.host || 'imap.qq.com',
      port: config.port || 993,
      user: config.user,
      password: config.password,
      tls: config.tls !== false,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 15000,
    });

    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(new Error('无法打开收件箱: ' + err.message));
        }

        const totalMessages = box.messages.total;
        // 获取最近 N 封邮件 (由设置决定，默认 20)
        const limit = config.limit || 20;
        const fetchCount = Math.min(totalMessages, limit);
        const startSeq = Math.max(1, totalMessages - fetchCount + 1);

        if (totalMessages === 0) {
          imap.end();
          return resolve([]);
        }

        // 获取完整源码，用 mailparser 正确解析 MIME
        const fetch = imap.seq.fetch(`${startSeq}:*`, {
          bodies: '',
          struct: true,
        });

        fetch.on('message', (msg, seqno) => {
          let rawSource = '';

          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              rawSource += chunk.toString('utf-8');
            });
          });

          msg.once('attributes', (attrs) => {
            msg.attrs = attrs;
          });

          msg.once('end', async () => {
            try {
              const parsed = await simpleParser(rawSource);

              const h = parseImapHeader(rawSource);
              const fromStr = decodeMimeWords(h.from) || '未知';
              const toStr = decodeMimeWords(h.to) || '';
              const subject = decodeMimeWords(h.subject) || '(无主题)';

              // parsed.text = text/plain 部分, parsed.html = text/html 部分
              const plainText = parsed.text || '';
              const htmlBody = parsed.html || '';

              // 正文：优先文本，其次 HTML 去标签
              const bodyFull = plainText || stripHtml(htmlBody);
              const bodyPreview = bodyFull.substring(0, 500);

              emails.push({
                uid: msg.attrs?.uid || seqno, seqno,
                from: fromStr, to: toStr,
                subject, date: h.date || '',
                bodyPreview, bodyFull,
                bodyHtml: htmlBody,
                hasAttachments: !!(parsed.attachments || []).length,
                flags: msg.attrs?.flags || [],
              });
            } catch (_) {
              const h = parseImapHeader(rawSource);
              emails.push({
                uid: msg.attrs?.uid || seqno, seqno,
                from: decodeMimeWords(h.from) || '未知',
                to: decodeMimeWords(h.to) || '',
                subject: decodeMimeWords(h.subject) || '(无主题)',
                date: h.date || '',
                bodyPreview: rawSource.substring(0, 500),
                bodyFull: '', bodyHtml: '',
                hasAttachments: false,
                flags: msg.attrs?.flags || [],
              });
            }
          });
        });

        fetch.once('error', (err) => {
          reject(new Error('获取邮件失败: ' + err.message));
        });

        fetch.once('end', () => {
          imap.end();
          // 按日期倒序排列
          emails.sort((a, b) => {
            const da = new Date(a.date);
            const db = new Date(b.date);
            return db - da;
          });
          resolve(emails);
        });
      });
    });

    imap.once('error', (err) => {
      reject(new Error('IMAP 连接错误: ' + err.message));
    });

    imap.once('end', () => {
      console.log('IMAP 连接已关闭');
    });

    imap.connect();
  });
}

/**
 * 简单解析 IMAP 邮件头部 (回退方案)
 */
function parseImapHeader(header) {
  const result = {};

  const fromMatch = header.match(/^From:\s*(.+)$/im);
  if (fromMatch) result.from = fromMatch[1].trim();

  const toMatch = header.match(/^To:\s*(.+)$/im);
  if (toMatch) result.to = toMatch[1].trim();

  const subjectMatch = header.match(/^Subject:\s*(.+)$/im);
  if (subjectMatch) result.subject = subjectMatch[1].trim();

  const dateMatch = header.match(/^Date:\s*(.+)$/im);
  if (dateMatch) result.date = dateMatch[1].trim();

  return result;
}

/**
 * HTML 转纯文本
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 解码 MIME 编码字词 (RFC 2047) 例: =?UTF-8?B?xxx?= → 中文
 */
function decodeMimeWords(text) {
  if (!text) return text;
  return text.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_m, charset, enc, str) => {
      try {
        let buf;
        if (enc.toUpperCase() === 'B') buf = Buffer.from(str, 'base64');
        else {
          const q = str.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
          buf = Buffer.from(q, 'binary');
        }
        return buf.toString('utf-8');
      } catch (_) { return str; }
    }
  );
}

module.exports = { fetchEmailsViaImap };
