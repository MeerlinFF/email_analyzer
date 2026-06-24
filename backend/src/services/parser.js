/**
 * EML 邮件解析服务
 * 使用 mailparser 解析 .eml 文件，提取元数据和正文
 */
const { simpleParser } = require('mailparser');
const fs = require('fs').promises;

/**
 * 解析 .eml 文件
 * @param {string} filePath - .eml 文件路径
 * @returns {Object} 解析后的邮件数据
 */
async function parseEmlFile(filePath) {
  const emlContent = await fs.readFile(filePath, 'utf-8');
  const parsed = await simpleParser(emlContent);

  // 提取纯文本正文 (优先 text，回退到 html 转纯文本)
  let bodyText = parsed.text || '';

  if (!bodyText && parsed.html) {
    bodyText = stripHtml(parsed.html);
  }

  // 提取附件信息
  const attachments = (parsed.attachments || []).map((att) => ({
    filename: att.filename || 'unnamed',
    contentType: att.contentType,
    size: att.size,
    contentDisposition: att.contentDisposition,
    // 二进制内容暂存为 base64，后续按需写入磁盘
    contentBase64: att.content ? att.content.toString('base64') : null,
    checksum: att.checksum,
  }));

  // 分离 PDF 附件
  const pdfAttachments = attachments.filter(
    (a) => a.contentType === 'application/pdf' || (a.filename || '').endsWith('.pdf')
  );

  return {
    messageId: parsed.messageId || '',
    from: formatAddress(parsed.from),
    to: formatAddressList(parsed.to),
    cc: formatAddressList(parsed.cc),
    subject: parsed.subject || '(无主题)',
    date: parsed.date ? parsed.date.toISOString() : null,
    bodyText: bodyText.substring(0, 10000), // 截断过长正文
    bodyLength: bodyText.length,
    attachments,
    pdfAttachments,
    hasAttachments: attachments.length > 0,
    headerLines: parsed.headerLines || [],
  };
}

/**
 * 去除 HTML 标签，获取纯文本
 */
function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 格式化单个地址
 */
function formatAddress(addr) {
  if (!addr) return null;
  return {
    name: addr.text || '',
    email: (addr.value || [])[0]?.address || '',
  };
}

/**
 * 格式化地址列表
 */
function formatAddressList(addrList) {
  if (!addrList || !Array.isArray(addrList)) return [];
  return addrList.map(formatAddress).filter(Boolean);
}

module.exports = { parseEmlFile };
