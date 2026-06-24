/**
 * PDF 附件解析服务
 * 使用 pdf-parse 提取 PDF 中的文本内容
 */
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const config = require('../config');

/**
 * 解析 PDF 附件并提取文本
 * @param {Object} attachment - 附件元数据 (需包含 contentBase64)
 * @param {string} taskId - 任务 ID (用于文件命名)
 * @returns {Object} 解析结果
 */
async function parsePdfAttachment(attachment, taskId) {
  const buffer = Buffer.from(attachment.contentBase64, 'base64');

  // 将 PDF 写入磁盘 (pdf-parse 需要)
  const fileName = `${taskId}_${Date.now()}_${attachment.filename || 'attach.pdf'}`;
  const filePath = path.join(config.UPLOAD_DIR, fileName);
  await fs.writeFile(filePath, buffer);

  try {
    const pdfBuffer = await fs.readFile(filePath);
    const data = await pdfParse(pdfBuffer);

    // 清理临时文件
    await fs.unlink(filePath).catch(() => {});

    return {
      filename: attachment.filename,
      pageCount: data.numpages,
      text: data.text.substring(0, 8000), // 截断过长文本
      fullLength: data.text.length,
      info: data.info || {},
    };
  } catch (err) {
    // 清理临时文件
    await fs.unlink(filePath).catch(() => {});
    return {
      filename: attachment.filename,
      pageCount: 0,
      text: '',
      error: err.message,
    };
  }
}

/**
 * 批量解析 PDF 附件
 * @param {Array} attachments - 附件列表
 * @param {string} taskId - 任务 ID
 * @returns {Array} 解析结果数组
 */
async function parseAllPdfAttachments(attachments, taskId) {
  const results = [];
  for (const att of attachments) {
    if (
      att.contentType === 'application/pdf' ||
      (att.filename || '').toLowerCase().endsWith('.pdf')
    ) {
      const result = await parsePdfAttachment(att, taskId);
      results.push(result);
    }
  }
  return results;
}

module.exports = { parsePdfAttachment, parseAllPdfAttachments };
