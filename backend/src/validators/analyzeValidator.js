/**
 * 请求参数校验 (Zod)
 */
const { z } = require('zod');

/**
 * 分析请求校验 schema
 */
const analyzeRequestSchema = z.object({
  // 文件上传由 multer 处理，这里校验额外参数
  options: z
    .object({
      skipPdf: z.boolean().optional().default(false),
      language: z.enum(['zh', 'en']).optional().default('zh'),
    })
    .optional()
    .default({}),
});

/**
 * IMAP 连接参数校验 schema
 */
const imapConfigSchema = z.object({
  host: z.string().min(1, '服务器地址不能为空'),
  port: z.number().int().min(1).max(65535).default(993),
  user: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '密码不能为空'),
  tls: z.boolean().default(true),
});

/**
 * 校验中间件工厂函数
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: '参数校验失败',
        errors: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    req.validated = result.data;
    next();
  };
}

module.exports = {
  analyzeRequestSchema,
  imapConfigSchema,
  validate,
};
