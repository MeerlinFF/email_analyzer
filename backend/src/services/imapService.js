/**
 * IMAP 邮件获取服务
 * 通过 IMAP 协议连接 QQ 邮箱，获取最近邮件列表
 *
 * 策略：先用 SEARCH 拿到最新 N 个 UID，再用 UID fetch 拉取正文
 * 这样 UID 始终准确，不会因为 seqno 漂移导致去重失败
 */
const Imap = require('imap');
const { simpleParser } = require('mailparser');

/**
 * @param {Object} config - { host, port, user, password, tls, limit }
 * @returns {Promise<Array>}  按日期从新到旧排序的邮件数组
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
    var pendingCount = 0;
    var fetchEnded = false;

    function tryResolve() {
      if (fetchEnded && pendingCount === 0) {
        imap.end();
        // 按日期字符串降序（ISO 格式天然可字符串比较）
        emails.sort(function (a, b) {
          return (b.date || '').localeCompare(a.date || '');
        });
        resolve(emails);
      }
    }

    imap.once('ready', function () {
      imap.openBox('INBOX', true, function (err, box) {
        if (err) { imap.end(); return reject(new Error('无法打开收件箱: ' + err.message)); }
        if (box.messages.total === 0) { imap.end(); return resolve([]); }

        var total = box.messages.total;
        var limit = Math.min(config.limit || 20, total);
        console.log('[IMAP] 收件箱共 ' + total + ' 封');

        // 如果配置了 sinceDays，用 SEARCH 按日期过滤（只拉近期邮件）
        if (config.sinceDays && config.sinceDays > 0) {
          var sinceDate = imapDateString(config.sinceDays);
          console.log('[IMAP] SEARCH SINCE ' + sinceDate + ' (最近 ' + config.sinceDays + ' 天)');
          imap.search([['SINCE', sinceDate]], function (searchErr, uids) {
            if (searchErr || !uids || uids.length === 0) {
              console.log('[IMAP] SEARCH 无结果，降级为 seq.fetch');
              doSeqFetch();
              return;
            }
            // UID 降序，取前 limit 个
            uids.sort(function (a, b) { return b - a; });
            var targetUids = uids.slice(0, Math.min(limit, uids.length));
            console.log('[IMAP] SEARCH 返回 ' + uids.length + ' 封，取最新 ' + targetUids.length + ' 封');
            doFetchByUid(targetUids);
          });
        } else {
          doSeqFetch();
        }

        function doSeqFetch() {
          var startSeq = Math.max(1, total - limit + 1);
          console.log('[IMAP] seq.fetch: ' + startSeq + ':*');
          var fetch = imap.seq.fetch(startSeq + ':*', { bodies: '', struct: true });
          setupFetchListeners(fetch);
        }

        function doFetchByUid(uids) {
          var fetch = imap.fetch(uids, { bodies: '', struct: true });
          setupFetchListeners(fetch);
        }

        function setupFetchListeners(fetch) {
          fetch.on('message', function (msg, seqno) {
            pendingCount++;
            var rawSource = '';
            var msgUid = null;

            msg.on('body', function (stream) {
              stream.on('data', function (chunk) { rawSource += chunk.toString('utf-8'); });
            });

            msg.once('attributes', function (attrs) {
              msgUid = attrs.uid;
            });

            msg.once('end', function () {
              var uid = msgUid || seqno;
            simpleParser(rawSource)
              .then(function (parsed) {
                var h = parseImapHeader(rawSource);
                var plainText = parsed.text || '';
                var htmlBody = parsed.html || '';
                var bodyFull = plainText || stripHtml(htmlBody);

                emails.push({
                  uid: uid,
                  seqno: seqno,
                  from: decodeMimeWords(h.from) || '未知',
                  to: decodeMimeWords(h.to) || '',
                  subject: decodeMimeWords(h.subject) || '(无主题)',
                  date: h.date || '',
                  bodyPreview: bodyFull.substring(0, 500),
                  bodyFull: bodyFull,
                  bodyHtml: htmlBody,
                  hasAttachments: !!(parsed.attachments || []).length,
                });
              })
              .catch(function () {
                var h2 = parseImapHeader(rawSource);
                emails.push({
                  uid: uid,
                  seqno: seqno,
                  from: decodeMimeWords(h2.from) || '未知',
                  to: decodeMimeWords(h2.to) || '',
                  subject: decodeMimeWords(h2.subject) || '(无主题)',
                  date: h2.date || '',
                  bodyPreview: rawSource.substring(0, 500),
                  bodyFull: '',
                  bodyHtml: '',
                  hasAttachments: false,
                });
              })
              .finally(function () {
                pendingCount--;
                tryResolve();
              });
          });
        });

        fetch.once('error', function (fetchErr) {
          reject(new Error('获取邮件失败: ' + fetchErr.message));
        });

        fetch.once('end', function () {
          fetchEnded = true;
          tryResolve();
        });
        }  // setupFetchListeners
      });  // openBox
    });    // ready

    imap.once('error', function (err) { reject(new Error('IMAP 连接错误: ' + err.message)); });
    imap.once('end', function () { console.log('IMAP 连接已关闭'); });
    imap.connect();
  });
}

/**
 * 生成 IMAP 格式的日期字符串 (DD-Mon-YYYY)
 * 例: imapDateString(90) → "28-Mar-2026"（90天前）
 */
function imapDateString(daysAgo) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.getDate() + '-' + months[d.getMonth()] + '-' + d.getFullYear();
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
  if (dateMatch) result.date = toIsoDate(dateMatch[1].trim());

  return result;
}

/**
 * IMAP 日期格式 → ISO 8601 (YYYY-MM-DD HH:MM:SS)
 * 输入: "Mon, 22 Jun 2026 23:05:14 +0000" 或 "Wed, 05 Aug 2020 11:48:38 +0000 (UTC)"
 */
function toIsoDate(str) {
  var d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }
  return str;
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
