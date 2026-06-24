<template>
  <el-drawer
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="邮件详情"
    size="650px"
    direction="rtl"
  >
    <template v-if="email">
      <!-- 邮件基本信息 -->
      <el-descriptions :column="1" border size="small" class="email-info">
        <el-descriptions-item label="发件人">
          {{ email.from?.name || email.from }}
          <span v-if="email.from?.email" class="email-addr">&lt;{{ email.from.email }}&gt;</span>
        </el-descriptions-item>
        <el-descriptions-item label="收件人">
          {{ formatRecipients(email.to) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="email.cc?.length" label="抄送">
          {{ formatRecipients(email.cc) }}
        </el-descriptions-item>
        <el-descriptions-item label="主题">
          <strong>{{ email.subject }}</strong>
        </el-descriptions-item>
        <el-descriptions-item label="日期">
          {{ formatFullDate(email.date) }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- Tab 切换：AI分析 | 邮件正文 | 原始内容 -->
      <el-tabs v-model="activeTab" class="detail-tabs">
        <!-- AI 分析 -->
        <el-tab-pane label="AI 分析" name="ai">
          <template v-if="email.analysis?.analyzed">
            <div class="analysis-section">
              <div class="analysis-tags">
                <el-tag :type="getSentimentType(email.analysis.sentiment)" size="large">
                  {{ emojiSentiment(email.analysis.sentiment) }}
                  {{ email.analysis.sentiment }}
                </el-tag>
                <el-tag :type="getPriorityType(email.analysis.priority)" size="large">
                  {{ emojiPriority(email.analysis.priority) }}
                  优先级: {{ email.analysis.priority }}
                </el-tag>
                <el-tag :type="getCategoryTagType(email.analysis.category)" size="large">
                  {{ email.analysis.category }}
                </el-tag>
              </div>

              <div class="analysis-summary">
                <h4>📝 摘要</h4>
                <p>{{ email.analysis.summary }}</p>
              </div>

              <div class="analysis-keywords" v-if="email.analysis.keywords?.length">
                <h4>🏷️ 关键词</h4>
                <div class="keyword-list">
                  <el-tag
                    v-for="kw in email.analysis.keywords"
                    :key="kw"
                    type="info"
                    effect="plain"
                  >{{ kw }}</el-tag>
                </div>
              </div>
            </div>
          </template>
          <el-empty
            v-else
            description="该邮件尚未进行 AI 分析，请点击列表中的「AI 分析」按钮"
            :image-size="100"
          />
        </el-tab-pane>

        <!-- 邮件正文 -->
        <el-tab-pane label="邮件正文" name="body">
          <div class="email-body">
            <pre>{{ email.bodyText || email.bodyPreview || '(无正文)' }}</pre>
          </div>
        </el-tab-pane>

        <!-- 原始内容 -->
        <el-tab-pane label="原始内容" name="raw">
          <div class="raw-header">
            <el-button size="small" type="primary" plain @click="loadRawContent">
              <el-icon><Refresh /></el-icon>
              加载原始邮件内容
            </el-button>
          </div>
          <div class="email-body raw-body" v-if="rawContent">
            <pre>{{ rawContent }}</pre>
          </div>
          <el-empty v-else description="点击上方按钮加载原始邮件内容" :image-size="80" />
        </el-tab-pane>
      </el-tabs>

      <!-- 附件信息 -->
      <template v-if="email.pdfAttachments?.length">
        <el-divider content-position="left">📎 PDF 附件</el-divider>
        <div v-for="pdf in email.pdfAttachments" :key="pdf.filename" class="pdf-item">
          <el-icon color="#E6A23C"><Document /></el-icon>
          <span>{{ pdf.filename }}</span>
          <el-tag size="small" type="info">{{ pdf.pageCount }} 页</el-tag>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="drawer-footer">
        <el-button
          v-if="email?.analysis?.analyzed"
          type="primary"
          @click="$emit('export', { email, analysis: email.analysis })"
        >
          <el-icon><Download /></el-icon>
          导出 JSON
        </el-button>
        <el-button @click="$emit('update:visible', false)">关闭</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup>
import { ref, watch } from 'vue';
import { MagicStick, Download, Document, Refresh } from '@element-plus/icons-vue';

const props = defineProps({
  visible: Boolean,
  email: Object,
  analysis: Object,
});

const emit = defineEmits(['update:visible', 'export', 'fetchRaw']);

const activeTab = ref('ai');
const rawContent = ref('');

// 每次打开新邮件重置
watch(() => props.email, () => {
  activeTab.value = 'ai';
  rawContent.value = '';
});

function loadRawContent() {
  if (props.email?.uid) {
    emit('fetchRaw', props.email.uid);
    // 显示当前已有的正文作为原始内容
    rawContent.value = props.email.bodyPreview || '(无原始内容)';
  }
}

function emojiSentiment(s) {
  if (s === '正面') return '😊';
  if (s === '负面') return '😟';
  return '😐';
}
function emojiPriority(p) {
  if (p === '高') return '🔴';
  if (p === '中') return '🟡';
  return '🟢';
}

// ─── 辅助 ────────────────────────────────────────────

function formatRecipients(list) {
  if (!list || !list.length) return '-';
  return list.map((r) => r.name || r.email || r).join('; ');
}

function formatFullDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('zh-CN');
}

function getSentimentType(s) {
  if (s === '正面') return 'success';
  if (s === '负面') return 'danger';
  return 'info';
}

function getPriorityType(p) {
  if (p === '高') return 'danger';
  if (p === '中') return 'warning';
  return 'success';
}

function getCategoryTagType(c) {
  const map = {
    '紧急/重要': 'danger',
    '财务/账单': 'danger',
    '会议/日程': 'success',
    '通知/公告': 'warning',
    '推广/营销': 'warning',
  };
  return map[c] || '';
}
</script>

<style scoped>
.email-info {
  margin-bottom: 16px;
}

.detail-tabs {
  margin-top: 8px;
}

.raw-header {
  margin-bottom: 12px;
}

.raw-body pre {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  max-height: 500px;
}

.email-addr {
  color: #909399;
  font-size: 13px;
}

.analysis-section {
  background: #f8f9fb;
  border-radius: 8px;
  padding: 16px;
}

.analysis-tags {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.analysis-summary h4,
.analysis-keywords h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #606266;
}

.analysis-summary p {
  margin: 0;
  line-height: 1.8;
  color: #303133;
}

.keyword-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.email-body {
  background: #fafafa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.email-body pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.7;
  color: #303133;
}

.pdf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
