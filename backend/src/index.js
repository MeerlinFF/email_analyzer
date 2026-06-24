const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const analyzeRoutes = require('./routes/analyze');
const { taskCleanupScheduler } = require('./services/taskManager');
const { cleanOldEmails } = require('./services/emailStore');

const app = express();

// ─── 中间件 ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件 (上传的附件等)
app.use('/uploads', express.static(config.UPLOAD_DIR));

// ─── 路由 ───────────────────────────────────────────
app.use('/api', analyzeRoutes);

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// 全局错误处理
app.use((err, _req, res, _next) => {
  console.error('[Global Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || '服务器内部错误',
  });
});

// ─── 启动 ───────────────────────────────────────────
app.listen(config.PORT, () => {
  console.log(`🚀 邮件分析服务已启动: http://localhost:${config.PORT}`);
  console.log(`📋 健康检查: http://localhost:${config.PORT}/health`);

  // 启动过期任务清理 (内存 Map)
  taskCleanupScheduler();

  // 启动旧邮件清理 (SQLite, 保留7天)
  cleanOldEmails();
  setInterval(cleanOldEmails, 6 * 60 * 60 * 1000); // 每6小时
});
