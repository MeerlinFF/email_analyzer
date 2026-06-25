/**
 * 邮件持久化存储服务
 * 封装 SQLite CRUD 操作，提供简洁接口
 */
const { stmts } = require('./database');

/**
 * 保存 IMAP 获取的邮件列表
 * @param {Array} emails - 邮件对象数组
 * @param {string} source - 来源 'imap' | 'upload'
 * @returns {number} 新增数量
 */
function saveEmails(emails, source = 'imap') {
  let inserted = 0;

  const insertMany = stmts.insertEmail;
  for (const email of emails) {
    try {
      insertMany.run({
        uid: String(email.uid || email.seqno || ''),
        from_addr: email.from || '',
        to_addr: email.to || '',
        subject: email.subject || '(无主题)',
        date: email.date || '',
        body_preview: (email.bodyPreview || '').substring(0, 500),
        has_attachments: email.hasAttachments ? 1 : 0,
        flags: JSON.stringify(email.flags || []),
        source,
      });
      // 同时存储完整正文
      // 同时存储完整正文
      if (email.bodyFull) {
        saveRawBody(String(email.uid || email.seqno || ''), email.bodyFull);
      }
      if (email.bodyHtml) {
        const { db } = require('./database');
        db.prepare('UPDATE emails SET body_html = @html WHERE uid = @uid').run({ uid: String(email.uid || email.seqno || ''), html: email.bodyHtml });
      }
      inserted++;
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT') {
        console.error('[EmailStore] 保存失败:', err.message);
      }
    }
  }
  return inserted;
}

/**
 * 保存单个 EML 解析结果 (上传分析后)
 * @param {Object} emailData - parser.js 返回的邮件数据
 */
function saveParsedEmail(emailData) {
  const uid = emailData.messageId || `eml_${Date.now()}`;
  try {
    stmts.insertEmail.run({
      uid,
      from_addr: emailData.from
        ? `${emailData.from.name} <${emailData.from.email}>`
        : '',
      to_addr: (emailData.to || []).map((t) => `${t.name} <${t.email}>`).join(', '),
      subject: emailData.subject || '(无主题)',
      date: emailData.date || new Date().toISOString(),
      body_preview: (emailData.bodyText || '').substring(0, 500),
      has_attachments: emailData.hasAttachments ? 1 : 0,
      flags: '[]',
      source: 'upload',
    });
  } catch (err) {
    if (err.code !== 'SQLITE_CONSTRAINT') {
      console.error('[EmailStore] 保存失败:', err.message);
    }
  }
}

/**
 * 将 AI 分析结果绑定到邮件
 * @param {string} uid - 邮件 UID
 * @param {Object} analysis - AI 分析结果
 */
function attachAnalysis(uid, analysis) {
  stmts.updateAnalysis.run({
    uid,
    summary: analysis.summary || '',
    category: analysis.category || '其他',
    keywords: JSON.stringify(analysis.keywords || []),
    sentiment: analysis.sentiment || '中性',
    priority: analysis.priority || '中',
  });
}

/**
 * 获取所有已存储邮件 (最近 200 封)
 * @returns {Array}
 */
function getAllEmails() {
  const rows = stmts.getAllEmails.all();
  return rows.map(formatEmailRow);
}

/**
 * 根据 UID 查找邮件
 * @param {string} uid
 * @returns {Object|null}
 */
function getEmailByUid(uid) {
  const row = stmts.getEmailByUid.get({ uid });
  return row ? formatEmailRow(row) : null;
}

/**
 * 清理 7 天前旧邮件
 */
function cleanOldEmails() {
  const result = stmts.deleteOldEmails.run();
  if (result.changes > 0) {
    console.log(`🧹 清理了 ${result.changes} 封旧邮件`);
  }
}

/**
 * 格式化行数据为前端友好格式
 */
function formatEmailRow(row) {
  return {
    id: row.id,
    uid: row.uid,
    from: row.from_addr,
    to: row.to_addr,
    subject: row.subject,
    date: row.date,
    bodyPreview: row.body_preview,
    bodyText: row.body_full || row.body_preview,
    bodyHtml: row.body_html || '',
    hasAttachments: !!row.has_attachments,
    flags: safeJsonParse(row.flags, []),
    analysis: {
      summary: row.ai_summary,
      category: row.ai_category,
      keywords: safeJsonParse(row.ai_keywords, []),
      sentiment: row.ai_sentiment,
      priority: row.ai_priority,
      analyzed: !!row.analyzed,
    },
    source: row.source,
    createdAt: row.created_at,
  };
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ─── 设置管理 ────────────────────────────────────────

/**
 * 获取所有设置 (键值对)
 */
function getSettings() {
  const rows = stmts.getAllSettings.all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

/**
 * 更新设置 (批量)
 * @param {Object} updates - { key: value, ... }
 */
function updateSettings(updates) {
  const keys = Object.keys(updates);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = String(updates[key]);
    stmts.setSetting.run({ key: key, value: value });
  }
}

// ─── 原始正文 ────────────────────────────────────────

/**
 * 存储邮件完整正文
 */
function saveRawBody(uid, body) {
  stmts.updateRawBody.run({ uid, body: body || '' });
}

/**
 * 获取邮件完整正文
 */
function getRawBody(uid) {
  const row = stmts.getEmailBodyByUid.get({ uid });
  return row ? { bodyPreview: row.body_preview, bodyFull: row.body_full } : null;
}

// ─── 分类过滤 ────────────────────────────────────────

/**
 * 按 AI 分类获取邮件
 */
function getEmailsByCategory(category) {
  const rows = stmts.getEmailsByCategory.all({ category });
  return rows.map(formatEmailRow);
}

// ─── 批量删除 ────────────────────────────────────────

/**
 * 批量删除邮件
 * @param {Array} uids - UID 数组
 * @returns {number} 删除数量
 */
function deleteEmails(uids) {
  if (!uids || uids.length === 0) return 0;
  // better-sqlite3 不支持 IN (@arr) 动态展开，用临时字符串拼接
  const placeholders = uids.map(() => '?').join(',');
  const stmt = require('./database').db.prepare(
    `DELETE FROM emails WHERE uid IN (${placeholders})`
  );
  const result = stmt.run(...uids);
  return result.changes;
}

module.exports = {
  saveEmails,
  saveParsedEmail,
  attachAnalysis,
  getAllEmails,
  getEmailByUid,
  cleanOldEmails,
  getSettings,
  updateSettings,
  saveRawBody,
  getRawBody,
  getEmailsByCategory,
  deleteEmails,
};
