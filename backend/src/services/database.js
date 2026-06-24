/**
 * SQLite 数据库初始化与管理
 * 使用 better-sqlite3 同步 API，轻量零配置
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'email_analyzer.db');

// 确保 data 目录存在
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// 启用 WAL 模式提升并发性能
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 建表 ───────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    uid         TEXT,
    from_addr   TEXT,
    to_addr     TEXT,
    subject     TEXT,
    date        TEXT,
    body_preview TEXT,
    has_attachments INTEGER DEFAULT 0,
    flags       TEXT,            -- JSON array
    raw_eml     TEXT,            -- 原始 EML 内容 (可选)
    
    -- 分析结果字段
    ai_summary  TEXT,
    ai_category TEXT,
    ai_keywords TEXT,            -- JSON array
    ai_sentiment TEXT,
    ai_priority TEXT,
    analyzed    INTEGER DEFAULT 0,  -- 0=未分析, 1=已分析
    
    source      TEXT DEFAULT 'imap', -- imap | upload
    created_at  TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT DEFAULT (datetime('now', 'localtime')),
    
    UNIQUE(uid)
  );

  CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
  CREATE INDEX IF NOT EXISTS idx_emails_category ON emails(ai_category);
`);

// 兼容旧表：添加 body_full 列 (如果不存在)
try {
  db.exec('ALTER TABLE emails ADD COLUMN body_full TEXT DEFAULT \'\'');
} catch (_) { /* 列已存在 */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ─── 默认设置 ───────────────────────────────────────
const defaultSettings = {
  imap_host: 'imap.qq.com',
  imap_port: '993',
  imap_user: '',
  imap_password: '',
  imap_tls: 'true',
  llm_api_key: '',
  llm_base_url: 'https://api.deepseek.com',
  llm_model: 'deepseek-chat',
  fetch_limit: '20',
};

const insertSetting = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)'
);
for (const [key, value] of Object.entries(defaultSettings)) {
  insertSetting.run({ key, value });
}

// ─── 预编译语句 (性能优化) ──────────────────────────

const stmts = {
  insertEmail: db.prepare(`
    INSERT OR REPLACE INTO emails
      (uid, from_addr, to_addr, subject, date, body_preview, has_attachments, flags, source, created_at)
    VALUES (@uid, @from_addr, @to_addr, @subject, @date, @body_preview, @has_attachments, @flags, @source, datetime('now', 'localtime'))
  `),

  updateAnalysis: db.prepare(`
    UPDATE emails
    SET ai_summary = @summary,
        ai_category = @category,
        ai_keywords = @keywords,
        ai_sentiment = @sentiment,
        ai_priority = @priority,
        analyzed = 1,
        updated_at = datetime('now', 'localtime')
    WHERE uid = @uid
  `),

  getAllEmails: db.prepare(`
    SELECT * FROM emails
    ORDER BY date DESC
    LIMIT 200
  `),

  getEmailByUid: db.prepare('SELECT * FROM emails WHERE uid = @uid'),

  deleteOldEmails: db.prepare(`
    DELETE FROM emails
    WHERE created_at < datetime('now', 'localtime', '-7 days')
  `),

  countEmails: db.prepare('SELECT COUNT(*) as count FROM emails'),

  // 设置
  getAllSettings: db.prepare('SELECT key, value FROM settings'),
  setSetting: db.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)'
  ),

  // 原始邮件正文
  updateRawBody: db.prepare(
    'UPDATE emails SET body_full = @body, updated_at = datetime(\'now\', \'localtime\') WHERE uid = @uid'
  ),
  getEmailBodyByUid: db.prepare('SELECT uid, body_preview, body_full FROM emails WHERE uid = @uid'),

  // 按分类过滤
  getEmailsByCategory: db.prepare(`
    SELECT * FROM emails WHERE ai_category = @category
    ORDER BY date DESC LIMIT 200
  `),

  // 批量删除
  deleteEmailsByUids: db.prepare('DELETE FROM emails WHERE uid IN (@uids)'),
};

module.exports = { db, stmts, DB_PATH };
