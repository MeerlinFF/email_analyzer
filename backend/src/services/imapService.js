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

        // 获取完整邮件源码，用 mailparser 正确解码
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
              // 使用 mailparser 解析完整邮件 (自动处理 MIME 解码)
              const parsed = await simpleParser(rawSource);

              const fromName = parsed.from?.text || '';
              const fromEmail = (parsed.from?.value || [])[0]?.address || '';
              const fromStr = fromName
                ? `${fromName} <${fromEmail}>`
                : fromEmail || '未知';

              const toStr = (parsed.to || [])
                .map((a) => a.text ? `${a.text} <${(a.value||[])[0]?.address||''}>` : (a.value||[])[0]?.address||'')
                .filter(Boolean)
                .join(', ') || '';

              // 提取纯文本正文
              let bodyFull = parsed.text || '';
              if (!bodyFull && parsed.html) {
                bodyFull = parsed.html
                  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                  .replace(/<br\s*\/?>/gi, '\n')
                  .replace(/<\/p>/gi, '\n')
                  .replace(/<\/div>/gi, '\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&amp;/g, '&')
                  .replace(/&quot;/g, '"')
                  .replace(/\n{3,}/g, '\n\n')
                  .trim();
              }

              const bodyPreview = bodyFull.substring(0, 500);

              emails.push({
                uid: msg.attrs?.uid || seqno,
                seqno,
                from: fromStr,
                to: toStr,
                subject: parsed.subject || '(无主题)',
                date: parsed.date ? parsed.date.toISOString() : '',
                bodyPreview,
                bodyFull,
                hasAttachments: !!(parsed.attachments || []).length,
                flags: msg.attrs?.flags || [],
              });
            } catch (_parseErr) {
              // mailparser 解析失败时回退到简单解析
              const parsed = parseImapHeader(rawSource);
              emails.push({
                uid: msg.attrs?.uid || seqno,
                seqno,
                from: decodeMimeWords(parsed.from) || '未知',
                to: decodeMimeWords(parsed.to) || '',
                subject: decodeMimeWords(parsed.subject) || '(无主题)',
                date: parsed.date || '',
                bodyPreview: rawSource.substring(0, 500),
                bodyFull: rawSource,
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
 * 解码 MIME 编码字词 (RFC 2047)
 * 例: =?UTF-8?B?5L2g5aW9?= → 你好
 *     =?ISO-2022-JP?B?GyRCJCIkJCQmJCgkKhsoQg==?= → 日本語
 */
function decodeMimeWords(text) {
  if (!text) return text;

  // 正则匹配 =?charset?encoding?encoded_text?=
  return text.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, charset, encoding, encodedText) => {
      try {
        let bytes;
        if (encoding.toUpperCase() === 'B') {
          bytes = Buffer.from(encodedText, 'base64');
        } else {
          // Q 编码: _→空格, =XX→十六进制
          const qText = encodedText
            .replace(/_/g, ' ')
            .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
              String.fromCharCode(parseInt(hex, 16))
            );
          bytes = Buffer.from(qText, 'binary');
        }
        return bytes.toString('utf-8');
      } catch (_e) {
        return encodedText;
      }
    }
  );
}

module.exports = { fetchEmailsViaImap };
