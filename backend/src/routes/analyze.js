/**
 * 分析 API 路由
 * - POST /api/analyze      上传 .eml 文件，启动分析任务
 * - GET  /api/analyze/:id/stream   SSE 实时进度流
 * - GET  /api/analyze/:id/result   获取分析结果
 * - POST /api/imap/fetch    通过 IMAP 获取邮件列表
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { createTask, getTask, addSSEClient } = require('../services/taskManager');
const { validate, imapConfigSchema } = require('../validators/analyzeValidator');
const {
  getAllEmails, saveEmails, saveParsedEmail, attachAnalysis,
  getSettings, updateSettings, getRawBody, getEmailsByCategory,
  deleteEmails, saveRawBody, getEmailByUid,
} = require('../services/emailStore');

const router = express.Router();

// ─── Multer 配置 ─────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // 确保上传目录存在
    if (!fs.existsSync(config.UPLOAD_DIR)) {
      fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
    }
    cb(null, config.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.eml';
    cb(null, `email-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.eml', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype === 'message/rfc822') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .eml 格式的邮件文件'), false);
    }
  },
});

// ─── POST /api/analyze ───────────────────────────────
// 上传 .eml 文件并启动分析任务
router.post('/analyze', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: '请上传 .eml 邮件文件',
    });
  }

  try {
    const taskId = createTask({
      filePath: req.file.path,
      options: req.body?.options || {},
    });

    console.log(`📨 新分析任务: ${taskId} - ${req.file.originalname}`);

    res.json({
      success: true,
      taskId,
      message: '任务已创建，请通过 SSE 监听进度',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: '创建任务失败: ' + err.message,
    });
  }
});

// ─── GET /api/analyze/:id/stream ─────────────────────
// SSE 实时进度推送
router.get('/analyze/:id/stream', (req, res) => {
  const taskId = req.params.id;
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ success: false, message: '任务不存在或已过期' });
    return;
  }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // 禁用 nginx 缓冲
  });

  // 立即发送当前状态
  const currentData = {
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    steps: task.steps,
    result: task.status === 'done' ? task.result : null,
    error: task.status === 'failed' ? task.error : null,
    timestamp: Date.now(),
  };
  res.write(`data: ${JSON.stringify(currentData)}\n\n`);

  // 如果任务已完成，直接关闭
  if (task.status === 'done' || task.status === 'failed') {
    res.write(`event: done\ndata: {"message":"任务已结束"}\n\n`);
    res.end();
    return;
  }

  // 注册 SSE 客户端，等待后续推送
  addSSEClient(taskId, res);

  // 心跳保活
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
  });
});

// ─── GET /api/analyze/:id/result ─────────────────────
// 获取完整分析结果
router.get('/analyze/:id/result', (req, res) => {
  const taskId = req.params.id;
  const task = getTask(taskId);

  if (!task) {
    return res.status(404).json({
      success: false,
      message: '任务不存在或已过期',
    });
  }

  if (task.status === 'done') {
    return res.json({
      success: true,
      taskId,
      status: task.status,
      result: task.result,
    });
  }

  if (task.status === 'failed') {
    return res.json({
      success: false,
      taskId,
      status: task.status,
      error: task.error,
    });
  }

  // 仍在处理中
  return res.json({
    success: true,
    taskId,
    status: task.status,
    progress: task.progress,
    steps: task.steps,
    message: '任务仍在处理中',
  });
});

// ─── GET /api/emails ─────────────────────────────────
// 获取数据库中已存储的所有邮件 (支持 ?category=xxx 过滤)
router.get('/emails', (req, res) => {
  try {
    const { category } = req.query;
    const emails = category
      ? getEmailsByCategory(category)
      : getAllEmails();
    res.json({ success: true, count: emails.length, emails });
  } catch (err) {
    res.status(500).json({ success: false, message: '获取邮件列表失败: ' + err.message });
  }
});

// ─── GET /api/emails/:uid/raw ────────────────────────
// 获取邮件原始正文 (用于查看原内容)
router.get('/emails/:uid/raw', (req, res) => {
  try {
    const body = getRawBody(req.params.uid);
    if (!body) return res.status(404).json({ success: false, message: '邮件不存在' });
    res.json({ success: true, ...body });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/emails ──────────────────────────────
// 批量删除邮件 (body: { uids: ["uid1", "uid2", ...] })
router.delete('/emails', (req, res) => {
  try {
    const { uids } = req.body;
    if (!uids || !Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的邮件 UID 列表' });
    }
    const count = deleteEmails(uids);
    res.json({ success: true, deleted: count, message: `已删除 ${count} 封邮件` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/settings ──────────────────────────────
router.get('/settings', (_req, res) => {
  try {
    const settings = getSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/settings ──────────────────────────────
router.post('/settings', (req, res) => {
  try {
    updateSettings(req.body);
    res.json({ success: true, message: '设置已保存' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/imap/fetch ────────────────────────────
// 通过 IMAP 获取邮件列表 + 自动入库 (优先使用存储的设置)
router.post('/imap/fetch', async (req, res) => {
  const { fetchEmailsViaImap } = require('../services/imapService');
  const settings = getSettings();

  try {
    // 优先使用请求体中的配置，回退到存储的设置
    const limit = parseInt(req.body?.limit || settings.fetch_limit || '20', 10);
    const imapConfig = {
      host: req.body?.host || settings.imap_host || 'imap.qq.com',
      port: parseInt(req.body?.port || settings.imap_port || '993', 10),
      user: req.body?.user || settings.imap_user || '',
      password: req.body?.password || settings.imap_password || '',
      tls: (req.body?.tls ?? settings.imap_tls ?? 'true') !== 'false',
      limit,
    };

    if (!imapConfig.user || !imapConfig.password) {
      return res.status(400).json({
        success: false,
        message: '请先在设置中配置邮箱地址和授权码',
      });
    }

    const emails = await fetchEmailsViaImap(imapConfig);

    const savedCount = saveEmails(emails, 'imap');
    console.log(`📥 IMAP 获取 ${emails.length} 封，新增入库 ${savedCount} 封`);
    const allEmails = getAllEmails();

    res.json({
      success: true,
      count: allEmails.length,
      newCount: savedCount,
      emails: allEmails,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'IMAP 连接失败: ' + err.message,
    });
  }
});

// ─── GET /api/imap/fetch-new/stream ──────────────────
// 增量拉取 + AI 分析 + SSE 实时日志
router.get('/imap/fetch-new/stream', async (req, res) => {
  const { fetchEmailsViaImap } = require('../services/imapService');
  const { analyzeEmail } = require('../services/aiService');
  const settings = getSettings();

  // 设置 SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function sendLog(message) {
    res.write(`data: ${JSON.stringify({ log: message })}\n\n`);
  }
  function sendDone(success, message, count) {
    res.write(`data: ${JSON.stringify({ done: true, success, message, count })}\n\n`);
    res.end();
  }

  try {
    sendLog('🔌 正在连接 QQ 邮箱...');

    const limit = parseInt(settings.fetch_limit || '20', 10) + 10; // 多拉一些做比较
    const imapConfig = {
      host: settings.imap_host || 'imap.qq.com',
      port: parseInt(settings.imap_port || '993', 10),
      user: settings.imap_user,
      password: settings.imap_password,
      tls: (settings.imap_tls || 'true') !== 'false',
      limit,
    };

    if (!imapConfig.user || !imapConfig.password) {
      return sendDone(false, '请先在设置中配置邮箱地址和授权码', 0);
    }

    const emails = await fetchEmailsViaImap(imapConfig);
    sendLog(`📥 IMAP 获取到 ${emails.length} 封邮件，正在筛选新邮件...`);

    // 筛选数据库中不存在的
    const newEmails = [];
    for (const email of emails) {
      const uid = String(email.uid || email.seqno || '');
      const existing = getEmailByUid(uid);
      if (!existing) newEmails.push(email);
    }

    sendLog(`🆕 发现 ${newEmails.length} 封新邮件`);

    if (newEmails.length === 0) {
      return sendDone(true, '没有新邮件', 0);
    }

    // 逐封分析
    let analyzedCount = 0;
    for (let i = 0; i < newEmails.length; i++) {
      const email = newEmails[i];
      const uid = String(email.uid || email.seqno || '');
      const label = email.subject
        ? email.subject.substring(0, 40)
        : '(无主题)';

      sendLog(`\n[${i + 1}/${newEmails.length}] 📧 ${label}`);

      try {
        // 构造 EML 给 simpleParser
        const emlContent = [
          `From: ${email.from}`,
          `To: ${email.to}`,
          `Subject: ${email.subject}`,
          `Date: ${email.date}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          email.bodyFull || email.bodyPreview || '',
        ].join('\r\n');

        // 保存邮件到 DB
        saveEmails([email], 'imap');
        if (email.bodyFull) {
          saveRawBody(uid, email.bodyFull);
        }
        sendLog('  💾 已保存到数据库');

        // AI 分析
        sendLog('  🤖 AI 分析中...');
        const emailData = {
          from: { name: email.from, email: '' },
          subject: email.subject,
          date: email.date,
          bodyText: email.bodyFull || email.bodyPreview || '',
        };

        const analysis = await analyzeEmail(emailData, []);
        sendLog(`  📊 分类: ${analysis.category} | ${analysis.sentiment} | 优先级: ${analysis.priority}`);
        sendLog(`  📝 ${(analysis.summary || '').substring(0, 80)}`);

        attachAnalysis(uid, analysis);
        analyzedCount++;
      } catch (err) {
        sendLog(`  ⚠️ 分析失败: ${err.message}`);
      }

      // 小延迟避免 API 限流
      if (i < newEmails.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    sendLog(`\n✅ 完成！共分析 ${analyzedCount} 封新邮件`);
    sendDone(true, `新增 ${newEmails.length} 封，已分析 ${analyzedCount} 封`, newEmails.length);
  } catch (err) {
    sendLog(`❌ 错误: ${err.message}`);
    sendDone(false, err.message, 0);
  }
});

module.exports = router;
