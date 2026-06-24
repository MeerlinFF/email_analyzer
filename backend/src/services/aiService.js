/**
 * DeepSeek AI 分析服务
 * 调用 DeepSeek API 生成邮件摘要和分类
 * 每次调用时从数据库读取最新 LLM 配置，支持运行时修改
 */
const axios = require('axios');

/**
 * 构建 DeepSeek 客户端 (每次调用时读取最新设置)
 */
function buildClient() {
  let baseURL = 'https://api.deepseek.com';
  let apiKey = '';

  try {
    const { getSettings } = require('./emailStore');
    const settings = getSettings();
    if (settings.llm_base_url) baseURL = settings.llm_base_url;
    if (settings.llm_api_key) apiKey = settings.llm_api_key;
  } catch (_) { /* 兜底 */ }

  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 120000,
  });
}

/**
 * 分析邮件内容，返回摘要和分类
 * @param {Object} emailData - 解析后的邮件数据
 * @param {Array} pdfResults - PDF 解析结果
 * @returns {Object} { summary, category, keywords, sentiment, priority }
 */
async function analyzeEmail(emailData, pdfResults = []) {
  // 构建 prompt
  const pdfContext = pdfResults
    .map((p) => `[附件: ${p.filename}]\n${p.text}`)
    .join('\n\n');

  const prompt = buildAnalysisPrompt(emailData, pdfContext);

  const messages = [
    {
      role: 'system',
      content: `你是一个专业的邮件分析助手。你需要分析邮件内容，提供：
1. 简洁的中文摘要（50-150字）
2. 分类标签（从以下选择最匹配的一项：工作/商务、个人/私人、通知/公告、财务/账单、推广/营销、会议/日程、技术支持、紧急/重要、其他）
3. 关键词（3-5个，逗号分隔）
4. 情感倾向（正面/中性/负面）
5. 紧急程度（高/中/低）

请以 JSON 格式返回，不要包含 markdown 代码块标记：
{
  "summary": "...",
  "category": "...",
  "keywords": ["...", "..."],
  "sentiment": "...",
  "priority": "..."
}`,
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  try {
    const client = buildClient();
    let model = 'deepseek-chat';
    try {
      const { getSettings } = require('./emailStore');
      const s = getSettings();
      if (s.llm_model) model = s.llm_model;
    } catch (_) {}

    console.log(`[DeepSeek] 调用模型: ${model}`);

    const response = await client.post('/v1/chat/completions', {
      model,
      messages,
      temperature: 0.3,
      max_tokens: 1000,
    });

    // 安全提取响应文本
    const resultText = response.data?.choices?.[0]?.message?.content || '';
    console.log(`[DeepSeek] 原始响应长度: ${resultText.length}`);
    console.log(`[DeepSeek] 原始响应前200字: ${resultText.substring(0, 200)}`);

    if (!resultText) {
      throw new Error('API 返回空内容，请检查 API Key 和账户余额');
    }

    // 尝试解析 JSON (处理可能的 markdown 代码块包裹)
    let parsed = null;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      // 提取 JSON 块
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    }

    if (!parsed) {
      throw new Error('无法解析 API 返回的 JSON: ' + resultText.substring(0, 200));
    }

    return {
      summary: parsed.summary || '无法生成摘要',
      category: parsed.category || '其他',
      keywords: parsed.keywords || [],
      sentiment: parsed.sentiment || '中性',
      priority: parsed.priority || '中',
      rawResponse: resultText,
    };
  } catch (err) {
    console.error('[DeepSeek API Error]',
      err.response ? JSON.stringify(err.response.data).substring(0, 300) : err.message);

    // 降级：返回基础分析
    return {
      summary: `邮件来自 ${emailData.from?.name || '未知'}，主题为"${emailData.subject}"`,
      category: guessCategory(emailData),
      keywords: [emailData.subject.split(' ').slice(0, 3).join(' ')],
      sentiment: '中性',
      priority: '中',
      error: err.message,
    };
  }
}

/**
 * 构建分析 Prompt
 */
function buildAnalysisPrompt(emailData, pdfContext) {
  let prompt = `请分析以下邮件：\n\n`;
  prompt += `发件人: ${emailData.from?.name || ''} <${emailData.from?.email || ''}>\n`;
  prompt += `主题: ${emailData.subject}\n`;
  prompt += `日期: ${emailData.date || '未知'}\n`;
  prompt += `正文:\n${emailData.bodyText}\n`;

  if (pdfContext) {
    prompt += `\n--- PDF 附件内容 ---\n${pdfContext}\n`;
  }

  return prompt;
}

/**
 * 简单的规则匹配分类（AI 不可用时的降级方案）
 */
function guessCategory(emailData) {
  const text = (emailData.subject + ' ' + emailData.bodyText).toLowerCase();
  const lowerSubj = emailData.subject.toLowerCase();

  const rules = [
    { cat: '会议/日程', kw: ['会议', 'meeting', '日程', 'calendar', '邀请', 'invitation'] },
    { cat: '财务/账单', kw: ['发票', 'invoice', '账单', 'bill', '支付', 'payment', '收据', 'receipt'] },
    { cat: '推广/营销', kw: ['促销', 'promo', '广告', 'ad', 'newsletter', '订阅', 'subscribe'] },
    { cat: '技术支持', kw: ['bug', 'error', '报错', '问题', 'issue', 'support', '技术支持'] },
    { cat: '通知/公告', kw: ['通知', 'notice', '公告', 'announcement', '更新', 'update'] },
    { cat: '紧急/重要', kw: ['紧急', 'urgent', '重要', 'important', '马上', 'asap'] },
  ];

  for (const rule of rules) {
    if (rule.kw.some((kw) => text.includes(kw))) {
      return rule.cat;
    }
  }

  return '工作/商务';
}

module.exports = { analyzeEmail };
