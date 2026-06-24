/**
 * 应用配置
 */
module.exports = {
  PORT: process.env.PORT || 3000,

  // DeepSeek API 配置
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || 'your-deepseek-api-key',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',

  // 上传配置
  UPLOAD_DIR: require('path').join(__dirname, '../../uploads'),
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB

  // 任务配置
  TASK_CLEANUP_INTERVAL: 30 * 60 * 1000, // 30分钟清理一次过期任务
  TASK_MAX_AGE: 2 * 60 * 60 * 1000,       // 任务保留2小时

  // IMAP 默认配置 (QQ邮箱)
  IMAP_DEFAULT: {
    host: 'imap.qq.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
  },
};
