<template>
  <el-card class="email-list-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="card-title">
          <el-icon><List /></el-icon>
          邮件列表
        </span>
        <div class="card-actions">
          <el-tag v-if="emails.length" type="info" size="small" style="margin-right: 8px">
            {{ emails.length }} 封
          </el-tag>
          <el-button
            v-if="selectedUids.length > 0"
            type="danger"
            size="small"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon>
            删除 ({{ selectedUids.length }})
          </el-button>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <el-empty
      v-if="!loading && emails.length === 0"
      description="暂无邮件，请连接 QQ 邮箱或上传 EML 文件"
      :image-size="120"
    />

    <!-- 加载状态 -->
    <el-skeleton v-if="loading" :rows="5" animated />

    <!-- 邮件表格 -->
    <el-table
      v-if="emails.length > 0"
      :data="emails"
      stripe
      style="width: 100%"
      @row-click="handleRowClick"
      @selection-change="handleSelectionChange"
      highlight-current-row
    >
      <el-table-column type="selection" width="40" />
      <el-table-column label="发件人" width="180">
        <template #default="{ row }">
          <div class="from-cell">
            <el-avatar :size="28" class="from-avatar">
              {{ (row.from || '?')[0] }}
            </el-avatar>
            <span class="from-name">{{ extractName(row.from) }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="主题" min-width="280">
        <template #default="{ row }">
          <div class="subject-cell">
            <span class="subject-text">{{ row.subject }}</span>
            <el-tag
              v-if="row.analysis?.category"
              :type="getCategoryType(row.analysis.category)"
              size="small"
              effect="plain"
            >
              {{ row.analysis?.category }}
            </el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="日期" width="170">
        <template #default="{ row }">
          <span class="date-text">{{ formatDate(row.date) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="附件" width="80" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.hasAttachments" color="#909399">
            <Paperclip />
          </el-icon>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click.stop="$emit('viewDetail', row)">
            查看
          </el-button>
          <el-button link type="success" size="small" @click.stop="$emit('analyze', row)">
            AI 分析
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { List, Paperclip, Delete } from '@element-plus/icons-vue';
import { deleteEmails } from '../api';

const props = defineProps({
  emails: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['viewDetail', 'analyze', 'deleted']);

const selectedUids = ref([]);

function handleSelectionChange(selection) {
  selectedUids.value = selection.map((row) => row.uid);
}

async function handleBatchDelete() {
  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedUids.value.length} 封邮件吗？此操作不可撤销。`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
    const result = await deleteEmails(selectedUids.value);
    ElMessage.success(result.message || `已删除 ${result.deleted} 封邮件`);
    selectedUids.value = [];
    emit('deleted');
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('删除失败: ' + (err.response?.data?.message || err.message));
    }
  }
}

// ─── 辅助方法 ────────────────────────────────────────

function extractName(from) {
  if (!from) return '未知';
  // 尝试提取名称部分 "张三 <zhangsan@qq.com>" -> "张三"
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split('@')[0];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diff = now - d;
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
  return d.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCategoryType(category) {
  const map = {
    '工作/商务': '',
    '个人/私人': 'info',
    '通知/公告': 'warning',
    '财务/账单': 'danger',
    '推广/营销': 'warning',
    '会议/日程': 'success',
    '技术支持': '',
    '紧急/重要': 'danger',
    '其他': 'info',
  };
  return map[category] || 'info';
}

function handleRowClick(row) {
  // 点击行也触发查看
}
</script>

<style scoped>
.email-list-card {
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-actions {
  display: flex;
  align-items: center;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.from-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.from-avatar {
  flex-shrink: 0;
  background: #409EFF;
  color: #fff;
  font-size: 13px;
}

.from-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.subject-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.date-text {
  color: #909399;
  font-size: 13px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
