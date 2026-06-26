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

// ─── DELETE /api/emails/all ──────────────────────────
router.delete('/emails/all', (_req, res) => {
  try {
    const { db } = require('../services/database');
    const result = db.prepare('DELETE FROM emails').run();
    res.json({ success: true, deleted: result.changes, message: `已清空 ${result.changes} 封邮件` });
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
    console.log('📥 IMAP 获取 ' + emails.length + ' 封，新增入库 ' + savedCount + ' 封');
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
// ?limit=1  单封模式：扫描最新 100 封，找到最新未入库的 1 封
// ?limit=N  多封模式：拉最新 N 封，分析所有未入库的
router.get('/imap/fetch-new/stream', async (req, res) => {
  var fetchLimit = parseInt(req.query.limit || '1', 10);
  var { fetchEmailsViaImap } = require('../services/imapService');
  var { analyzeEmail } = require('../services/aiService');
  var settings = getSettings();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function sendLog(msg) { res.write('data: ' + JSON.stringify({ log: msg }) + '\n\n'); }
  function sendDone(success, msg, count) {
    res.write('data: ' + JSON.stringify({ done: true, success: success, message: msg, count: count }) + '\n\n');
    res.end();
  }

  try {
    if (!settings.imap_user || !settings.imap_password) {
      return sendDone(false, '请先在设置中配置邮箱地址和授权码', 0);
    }

    sendLog('🔌 正在连接 QQ 邮箱...');

    // 共同 IMAP 配置
    var imapCfg = {
      host: settings.imap_host || 'imap.qq.com',
      port: parseInt(settings.imap_port || '993', 10),
      user: settings.imap_user,
      password: settings.imap_password,
      tls: (settings.imap_tls || 'true') !== 'false',
    };

    // ═══ 单封模式 ═══
    if (fetchLimit === 1) {
      // SEARCH 最近 365 天的邮件，取最新 200 封，本地按日期排序找第一封未入库的
      var batch = await fetchEmailsViaImap(Object.assign({}, imapCfg, { limit: 200, sinceDays: 365 }));

      if (batch.length === 0) return sendDone(true, '邮箱为空', 0);

      sendLog('📥 已获取最新 ' + batch.length + ' 封，查找未入库的...');

      // batch 已按日期从新到旧排序，找到第一个不在库中的
      var found = null;
      for (var i = 0; i < batch.length; i++) {
        var candidate = batch[i];
        var cUid = String(candidate.uid || candidate.seqno || '');
        if (!getEmailByUid(cUid)) {
          found = candidate;
          break;
        }
      }

      if (!found) {
        return sendDone(true, '最新 ' + batch.length + ' 封已全部入库，没有新邮件', 0);
      }

      // 只分析这一封
      var uid = String(found.uid || found.seqno || '');
      sendLog('📧 ' + (found.subject || '(无主题)').substring(0, 40));
      sendLog('🤖 AI 分析中...');
      saveEmails([found], 'imap');
      if (found.bodyFull) saveRawBody(uid, found.bodyFull);
      var analysis = await analyzeEmail(
        { from: { name: found.from, email: '' }, subject: found.subject, date: found.date, bodyText: found.bodyFull || found.bodyPreview || '' },
        []
      );
      sendLog('📊 ' + analysis.category + ' | ' + analysis.sentiment + ' | ' + analysis.priority);
      sendLog('📝 ' + (analysis.summary || '').substring(0, 80));
      attachAnalysis(uid, analysis);
      sendLog('✅ 完成！');
      return sendDone(true, '已拉取并分析 1 封新邮件', 1);
    }

    // ═══ 多封模式 ═══
    var emails = await fetchEmailsViaImap(Object.assign({}, imapCfg, { limit: fetchLimit, sinceDays: 365 }));

    sendLog('📥 获取最新 ' + emails.length + ' 封，筛选中...');

    // 筛出未入库的（保持从新到旧顺序）
    var newEmails = [];
    for (var k = 0; k < emails.length; k++) {
      var e = emails[k];
      if (!getEmailByUid(String(e.uid || e.seqno || ''))) {
        newEmails.push(e);
      }
    }

    if (newEmails.length === 0) return sendDone(true, '没有新邮件', 0);

    sendLog('🆕 ' + newEmails.length + ' 封未入库，开始 AI 分析...');

    var analyzedCount = 0;
    for (var n = 0; n < newEmails.length; n++) {
      var email = newEmails[n];
      var eUid = String(email.uid || email.seqno || '');
      var label = (email.subject || '(无主题)').substring(0, 40);

      sendLog('\n[' + (n + 1) + '/' + newEmails.length + '] 📧 ' + label);
      sendLog('  🤖 AI 分析中...');

      try {
        saveEmails([email], 'imap');
        if (email.bodyFull) saveRawBody(eUid, email.bodyFull);

        var result = await analyzeEmail(
          { from: { name: email.from, email: '' }, subject: email.subject, date: email.date, bodyText: email.bodyFull || email.bodyPreview || '' },
          []
        );
        sendLog('  📊 ' + result.category + ' | ' + result.sentiment + ' | ' + result.priority);
        sendLog('  📝 ' + (result.summary || '').substring(0, 80));
        attachAnalysis(eUid, result);
        analyzedCount++;
      } catch (err) {
        sendLog('  ⚠️ 分析失败: ' + err.message);
      }

      if (n < newEmails.length - 1) {
        await new Promise(function (r) { setTimeout(r, 500); });
      }
    }

    sendLog('\n✅ 完成！共分析 ' + analyzedCount + ' 封');
    sendDone(true, '新增 ' + newEmails.length + ' 封，已分析 ' + analyzedCount + ' 封', newEmails.length);
  } catch (err) {
    sendLog('❌ 错误: ' + err.message);
    sendDone(false, err.message, 0);
  }
});

module.exports = router;
