<template>
  <div class="detail-panel" :class="{ 'is-empty': !email }">
    <template v-if="email">
      <!-- 标题栏 -->
      <div class="detail-header">
        <h2 class="detail-subject">{{ email.subject }}</h2>
        <div class="detail-meta">
          <span class="detail-from">{{ extractName(email.from) }}</span>
          <span class="detail-date">{{ formatDate(email.date) }}</span>
        </div>
        <div class="detail-actions">
          <el-button
            v-if="email.analysis?.analyzed"
            size="small"
            @click="$emit('export', { email, analysis: email.analysis })"
          >
            <el-icon><Download /></el-icon> 导出 JSON
          </el-button>
          <el-button size="small" @click="$emit('close')">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 切换：AI 总结 | 原邮件 -->
      <div class="toggle-bar">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="ai">🤖 AI 总结</el-radio-button>
          <el-radio-button value="raw">📧 原邮件</el-radio-button>
        </el-radio-group>
      </div>

      <!-- AI 总结 -->
      <div v-if="viewMode === 'ai'" class="detail-content">
        <template v-if="email.analysis?.analyzed">
          <div class="analysis-tags">
            <el-tag :type="tagType(email.analysis.sentiment, 'sentiment')" size="small">
              {{ emoji(email.analysis.sentiment) }} {{ email.analysis.sentiment }}
            </el-tag>
            <el-tag :type="tagType(email.analysis.priority, 'priority')" size="small">
              {{ emoji(email.analysis.priority) }} {{ email.analysis.priority }}
            </el-tag>
            <el-tag :type="catTagType(email.analysis.category)" size="small">
              {{ email.analysis.category }}
            </el-tag>
          </div>
          <div class="summary-block">
            <p>{{ email.analysis.summary }}</p>
          </div>
          <div v-if="email.analysis.keywords?.length" class="keywords-block">
            <el-tag
              v-for="kw in email.analysis.keywords" :key="kw"
              size="small" type="info" effect="plain" class="kw-tag"
            >{{ kw }}</el-tag>
          </div>
        </template>
        <el-empty v-else description="该邮件尚未进行 AI 分析" :image-size="60" />
      </div>

      <!-- 原邮件 -->
      <div v-else class="detail-content">
        <div class="email-meta">
          <div><strong>发件人：</strong>{{ email.from }}</div>
          <div><strong>收件人：</strong>{{ formatRecipients(email.to) }}</div>
          <div v-if="email.cc?.length"><strong>抄送：</strong>{{ formatRecipients(email.cc) }}</div>
          <div><strong>日期：</strong>{{ formatFullDate(email.date) }}</div>
        </div>
        <div class="email-body">
          <pre>{{ email.bodyText || email.bodyPreview || '(无正文)' }}</pre>
        </div>
      </div>

      <!-- 附件 -->
      <div v-if="email.pdfAttachments?.length" class="attachments">
        <div class="attach-title">📎 附件</div>
        <div v-for="pdf in email.pdfAttachments" :key="pdf.filename" class="attach-item">
          <el-icon color="#E6A23C"><Document /></el-icon>
          <span>{{ pdf.filename }}</span>
          <el-tag size="small" type="info">{{ pdf.pageCount }} 页</el-tag>
        </div>
      </div>
    </template>
    <div v-else class="empty-state">
      <el-icon :size="48" color="#dcdfe6"><Message /></el-icon>
      <p>选择一封邮件查看详情</p>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { Download, Close, Document, Message } from '@element-plus/icons-vue';

const props = defineProps({ email: Object });
defineEmits(['export', 'fetchRaw', 'close']);

const viewMode = ref('ai');
watch(() => props.email, () => { viewMode.value = 'ai'; });

function extractName(from) {
  if (!from) return '未知';
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.split('@')[0];
}
function formatDate(d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t.getTime())) return d;
  const diff = Date.now() - t;
  if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff/3600000) + '小时前';
  return t.toLocaleDateString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function formatRecipients(list) {
  if (!list || !list.length) return '-';
  return list.map((r) => r.name || r.email || r).join('; ');
}
function formatFullDate(d) {
  if (!d) return '-';
  const t = new Date(d);
  return isNaN(t.getTime()) ? d : t.toLocaleString('zh-CN');
}
function emoji(v) {
  if (v === '正面' || v === '高') return v === '高' ? '🔴' : '😊';
  if (v === '负面' || v === '低') return v === '低' ? '🟢' : '😟';
  return v === '中' ? '🟡' : '😐';
}
function tagType(v, kind) {
  if (kind === 'sentiment') return v === '正面' ? 'success' : v === '负面' ? 'danger' : 'info';
  return v === '高' ? 'danger' : v === '中' ? 'warning' : 'success';
}
function catTagType(c) {
  const m = { '紧急/重要':'danger','财务/账单':'danger','会议/日程':'success','通知/公告':'warning','推广/营销':'warning' };
  return m[c] || '';
}
</script>

<style scoped>
.detail-panel {
  flex: 1; min-width: 0; background: #fff; border-left: 1px solid #e4e7ed;
  display: flex; flex-direction: column; overflow: hidden;
}
.detail-panel.is-empty {
  display: flex; align-items: center; justify-content: center;
}
.empty-state { text-align: center; color: #c0c4cc; }
.empty-state p { margin-top: 12px; font-size: 14px; }
.detail-header { padding: 16px 20px 12px; border-bottom: 1px solid #ebeef5; }
.detail-subject { font-size: 18px; font-weight: 600; color: #303133; margin: 0 0 8px; word-break: break-word; }
.detail-meta { display: flex; gap: 16px; font-size: 13px; color: #909399; margin-bottom: 10px; }
.detail-from { color: #409EFF; font-weight: 500; }
.detail-actions { display: flex; gap: 8px; }
.toggle-bar { padding: 10px 20px; border-bottom: 1px solid #ebeef5; }
.detail-content { flex: 1; overflow-y: auto; padding: 16px 20px; }
.analysis-tags { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.summary-block { background: #f0f9eb; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.summary-block p { margin: 0; line-height: 1.8; color: #303133; font-size: 14px; }
.keywords-block { display: flex; gap: 6px; flex-wrap: wrap; }
.email-meta { margin-bottom: 14px; font-size: 13px; color: #606266; line-height: 2; }
.email-body {
  background: #fafafa; border: 1px solid #ebeef5; border-radius: 6px;
  padding: 14px; max-height: calc(100vh - 380px); overflow-y: auto;
}
.email-body pre {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  font-family: inherit; font-size: 13px; line-height: 1.7; color: #303133;
}
.attachments { padding: 12px 20px; border-top: 1px solid #ebeef5; }
.attach-title { font-size: 13px; font-weight: 600; color: #606266; margin-bottom: 8px; }
.attach-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
</style>
