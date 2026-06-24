/**
 * API 客户端
 * 封装后端接口调用
 */
import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// ─── 邮件分析相关 ────────────────────────────────────

/**
 * 上传 .eml 文件并启动分析
 * @param {File} file - .eml 文件
 * @returns {Promise<{taskId: string}>}
 */
export function uploadAndAnalyze(file) {
  const formData = new FormData();
  formData.append('file', file);
  return http.post('/analyze', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((res) => res.data);
}

/**
 * 获取分析任务结果
 * @param {string} taskId
 */
export function getAnalysisResult(taskId) {
  return http.get(`/analyze/${taskId}/result`).then((res) => res.data);
}

// ─── IMAP 相关 ──────────────────────────────────────

/**
 * 通过 IMAP 获取邮件列表
 * @param {Object} config - { host, port, user, password, tls }
 */
export function fetchImapEmails(config) {
  return http.post('/imap/fetch', config).then((res) => res.data);
}

// ─── 持久化邮件 ────────────────────────────────────

/**
 * 获取数据库中已存储的邮件列表 (页面刷新恢复)
 * @param {string} category - 可选分类过滤
 */
export function fetchStoredEmails(category) {
  const params = category ? { category } : {};
  return http.get('/emails', { params }).then((res) => res.data);
}

/**
 * 获取邮件原始正文
 * @param {string} uid
 */
export function fetchRawEmail(uid) {
  return http.get(`/emails/${uid}/raw`).then((res) => res.data);
}

/**
 * 批量删除邮件
 * @param {Array} uids - 邮件 UID 列表
 */
export function deleteEmails(uids) {
  return http.delete('/emails', { data: { uids } }).then((res) => res.data);
}

// ─── 设置相关 ──────────────────────────────────────

/**
 * 获取应用设置
 */
export function fetchSettings() {
  return http.get('/settings').then((res) => res.data);
}

/**
 * 保存应用设置
 * @param {Object} settings - 键值对
 */
export function updateSettings(settings) {
  return http.post('/settings', settings).then((res) => res.data);
}

export default http;
