<template>
  <div class="email-list-panel">
    <!-- 搜索栏 -->
    <div class="list-header">
      <el-input v-model="search" placeholder="搜索邮件..." size="small" clearable>
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
      <el-button
        v-if="selectedUids.length > 0"
        type="danger" size="small"
        @click="handleBatchDelete"
      >
        <el-icon><Delete /></el-icon> {{ selectedUids.length }}
      </el-button>
    </div>

    <!-- 空状态 -->
    <el-empty v-if="!loading && list.length === 0" description="暂无邮件" :image-size="100" />

    <!-- 加载 -->
    <el-skeleton v-if="loading" :rows="8" animated class="skeleton-pad" />

    <!-- 邮件列表 -->
    <div v-if="list.length" class="email-items">
      <div
        v-for="email in list"
        :key="email.uid"
        class="email-item"
        :class="{ active: email.uid === selectedUid }"
        @click="$emit('select', email)"
      >
        <el-checkbox
          :model-value="selectedUids.includes(email.uid)"
          @change="(val) => toggleSelect(email.uid, val)"
          @click.stop
          class="item-check"
        />
        <div class="item-content">
          <div class="item-top">
            <span class="item-from">{{ extractName(email.from) }}</span>
            <span class="item-date">{{ formatDate(email.date) }}</span>
          </div>
          <div class="item-subject">{{ email.subject }}</div>
          <div class="item-preview">{{ email.bodyPreview || '' }}</div>
          <div class="item-tags">
            <el-tag
              v-if="email.analysis?.category"
              :type="catType(email.analysis.category)"
              size="small" effect="plain"
            >{{ email.analysis.category }}</el-tag>
            <el-tag
              v-if="email.analysis?.analyzed"
              type="success" size="small" effect="plain"
            >AI ✓</el-tag>
          </div>
        </div>
        <el-button
          v-if="!email.analysis?.analyzed"
          link type="primary" size="small"
          class="item-analyze-btn"
          @click.stop="$emit('analyze', email)"
        >AI 分析</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Delete } from '@element-plus/icons-vue';
import { deleteEmails } from '../api';

const props = defineProps({
  emails: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
  selectedUid: { type: String, default: '' },
});

const emit = defineEmits(['select', 'analyze', 'deleted']);

const search = ref('');
const selectedUids = ref([]);

const list = computed(() => {
  if (!search.value) return props.emails;
  const q = search.value.toLowerCase();
  return props.emails.filter((e) =>
    (e.subject || '').toLowerCase().includes(q) ||
    (e.from || '').toLowerCase().includes(q) ||
    (e.bodyPreview || '').toLowerCase().includes(q)
  );
});

function toggleSelect(uid, val) {
  if (val) selectedUids.value.push(uid);
  else selectedUids.value = selectedUids.value.filter((u) => u !== uid);
}

async function handleBatchDelete() {
  try {
    await ElMessageBox.confirm(`删除 ${selectedUids.value.length} 封邮件？`, '确认', { type: 'warning' });
    await deleteEmails(selectedUids.value);
    ElMessage.success(`已删除 ${selectedUids.value.length} 封`);
    selectedUids.value = [];
    emit('deleted');
  } catch (err) {
    if (err !== 'cancel') ElMessage.error('删除失败');
  }
}

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
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  return t.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}
function catType(c) {
  const m = { '紧急/重要': 'danger', '财务/账单': 'danger', '会议/日程': 'success', '通知/公告': 'warning', '推广/营销': 'warning', '个人/私人': 'info', '其他': 'info' };
  return m[c] || 'primary';
}
</script>

<style scoped>
.email-list-panel {
  width: 380px; min-width: 300px; background: #fff;
  border-right: 1px solid #e4e7ed; display: flex; flex-direction: column; overflow: hidden;
}
.list-header {
  padding: 10px 12px; border-bottom: 1px solid #ebeef5;
  display: flex; gap: 8px;
}
.skeleton-pad { padding: 16px; }
.email-items { flex: 1; overflow-y: auto; }
.email-item {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid #f0f0f0;
  cursor: pointer; transition: background .15s;
}
.email-item:hover { background: #f5f7fa; }
.email-item.active { background: #ecf5ff; border-left: 3px solid #409EFF; padding-left: 9px; }
.item-check { margin-top: 2px; flex-shrink: 0; }
.item-content { flex: 1; min-width: 0; }
.item-top { display: flex; justify-content: space-between; margin-bottom: 3px; }
.item-from { font-weight: 600; font-size: 13px; color: #303133; }
.item-date { font-size: 11px; color: #909399; flex-shrink: 0; }
.item-subject { font-size: 13px; color: #303133; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-preview { font-size: 12px; color: #909399; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 4px; }
.item-tags { display: flex; gap: 4px; }
.item-analyze-btn { flex-shrink: 0; margin-top: 2px; font-size: 12px; }
</style>
