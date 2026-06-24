/**
 * 分析任务 Worker Thread
 * 在独立线程中执行邮件解析 + PDF 解析 + AI 分析
 * 通过 parentPort.postMessage 向主线程汇报进度
 */
const { parentPort, workerData } = require('worker_threads');
const { parseEmlFile } = require('../services/parser');
const { parseAllPdfAttachments } = require('../services/pdfParser');
const { analyzeEmail } = require('../services/aiService');

// ─── 辅助：向主线程发送消息 ──────────────────────────
function sendProgress(type, data) {
  if (parentPort) {
    console.log(`[Worker] 发送消息: ${type}`);
    parentPort.postMessage({ type, data });
  }
}

// ─── 主流程 ──────────────────────────────────────────
(async () => {
  const { taskId, filePath } = workerData;

  try {
    // ── 阶段 1: 解析邮件文件 ──
    sendProgress('progress', {
      status: 'parsing',
      progress: 10,
      steps: [
        { title: '解析邮件文件', status: 'process', description: '正在读取并解析 .eml 文件...' },
        { title: '解析PDF附件',  status: 'wait',    description: '提取 PDF 附件中的文本内容' },
        { title: 'AI 智能分析',  status: 'wait',    description: '调用 DeepSeek 生成摘要与分类' },
        { title: '生成结果',     status: 'wait',    description: '汇总分析结果' },
      ],
    });

    const emailData = await parseEmlFile(filePath);

    sendProgress('progress', {
      status: 'parsing',
      progress: 35,
      steps: [
        { title: '解析邮件文件', status: 'finish',  description: `解析完成: ${emailData.subject}` },
        { title: '解析PDF附件',  status: 'process', description: `发现 ${emailData.pdfAttachments.length} 个 PDF 附件...` },
        { title: 'AI 智能分析',  status: 'wait',    description: '调用 DeepSeek 生成摘要与分类' },
        { title: '生成结果',     status: 'wait',    description: '汇总分析结果' },
      ],
    });

    // ── 阶段 2: 解析 PDF 附件 ──
    let pdfResults = [];
    if (emailData.pdfAttachments.length > 0) {
      pdfResults = await parseAllPdfAttachments(emailData.pdfAttachments, taskId);
    }

    sendProgress('progress', {
      status: 'analyzing',
      progress: 55,
      steps: [
        { title: '解析邮件文件', status: 'finish',  description: `解析完成: ${emailData.subject}` },
        { title: '解析PDF附件',  status: pdfResults.length > 0 ? 'finish' : 'finish',
          description: pdfResults.length > 0 ? `已解析 ${pdfResults.length} 个 PDF` : '无 PDF 附件' },
        { title: 'AI 智能分析',  status: 'process', description: '正在调用 DeepSeek API 分析邮件内容...' },
        { title: '生成结果',     status: 'wait',    description: '汇总分析结果' },
      ],
    });

    // ── 阶段 3: AI 分析 ──
    console.log('[Worker] 开始 AI 分析...');
    const aiResult = await analyzeEmail(emailData, pdfResults);
    console.log(`[Worker] AI 分析完成: ${aiResult.category}, 摘要: ${aiResult.summary?.substring(0, 50)}...`);

    // ── 阶段 4: 汇总结果 ──
    sendProgress('progress', {
      status: 'analyzing',
      progress: 90,
      steps: [
        { title: '解析邮件文件', status: 'finish', description: `解析完成: ${emailData.subject}` },
        { title: '解析PDF附件',  status: 'finish',
          description: pdfResults.length > 0 ? `已解析 ${pdfResults.length} 个 PDF` : '无 PDF 附件' },
        { title: 'AI 智能分析',  status: 'finish', description: `分析完成: ${aiResult.category}` },
        { title: '生成结果',     status: 'process', description: '汇总分析结果...' },
      ],
    });

    // 构建最终结果
    const finalResult = {
      email: {
        messageId: emailData.messageId,
        from: emailData.from,
        to: emailData.to,
        cc: emailData.cc,
        subject: emailData.subject,
        date: emailData.date,
        bodyText: emailData.bodyText,
        hasAttachments: emailData.hasAttachments,
      },
      pdfAttachments: pdfResults.map((p) => ({
        filename: p.filename,
        pageCount: p.pageCount,
        textPreview: p.text ? p.text.substring(0, 500) + '...' : '',
        error: p.error,
      })),
      analysis: {
        summary: aiResult.summary,
        category: aiResult.category,
        keywords: aiResult.keywords,
        sentiment: aiResult.sentiment,
        priority: aiResult.priority,
      },
      analyzedAt: new Date().toISOString(),
    };

    // 发送最终结果
    sendProgress('result', {
      steps: [
        { title: '解析邮件文件', status: 'finish', description: `解析完成: ${emailData.subject}` },
        { title: '解析PDF附件',  status: 'finish',
          description: pdfResults.length > 0 ? `已解析 ${pdfResults.length} 个 PDF` : '无 PDF 附件' },
        { title: 'AI 智能分析',  status: 'finish', description: `分析完成: ${aiResult.category}` },
        { title: '生成结果',     status: 'finish', description: '分析报告已生成' },
      ],
      result: finalResult,
    });

    console.log('[Worker] ✅ 任务完成，即将退出');
  } catch (err) {
    console.error('[Worker] ❌ 异常:', err.message);
    sendProgress('error', {
      message: err.message,
    });
  }
})();
