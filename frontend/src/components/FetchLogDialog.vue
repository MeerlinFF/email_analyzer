<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="拉取新邮件"
    width="650px"
    :close-on-click-modal="false"
    @open="startFetch"
  >
    <!-- 日志区域 -->
    <div class="log-container" ref="logRef">
      <div v-if="logs.length === 0" class="log-empty">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>正在连接...</span>
      </div>
      <div
        v-for="(line, idx) in logs"
        :key="idx"
        class="log-line"
        :class="{ 'log-highlight': line.startsWith('✅') || line.startsWith('📊') }"
      >
        {{ line }}
      </div>
    </div>

    <!-- 进度 -->
    <div class="log-status" v-if="!finished">
      <el-progress :percentage="progress" :show-text="false" :stroke-width="4" />
    </div>

    <template #footer>
      <el-button v-if="finished" type="primary" @click="handleClose">
        关闭
      </el-button>
      <el-button v-else disabled>
        <el-icon class="is-loading"><Loading /></el-icon>
        处理中...
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { Loading } from '@element-plus/icons-vue';

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(['update:visible', 'done']);

const logs = ref([]);
const progress = ref(0);
const finished = ref(false);
const logRef = ref(null);

let eventSource = null;

function startFetch() {
  logs.value = [];
  progress.value = 0;
  finished.value = false;

  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/imap/fetch-new/stream');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.log) {
      logs.value.push(data.log);
      // 估算进度
      const match = data.log.match(/\[(\d+)\/(\d+)\]/);
      if (match) {
        progress.value = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
      }
      scrollToBottom();
    }

    if (data.done) {
      finished.value = true;
      progress.value = 100;
      eventSource.close();
      eventSource = null;
      if (data.success) {
        ElMessage.success(data.message);
      } else {
        ElMessage.error(data.message);
      }
    }
  };

  eventSource.onerror = () => {
    if (eventSource?.readyState === EventSource.CLOSED) {
      if (!finished.value) {
        logs.value.push('⚠️ 连接中断');
        finished.value = true;
      }
      eventSource = null;
    }
  };
}

function scrollToBottom() {
  nextTick(() => {
    if (logRef.value) {
      logRef.value.scrollTop = logRef.value.scrollHeight;
    }
  });
}

function handleClose() {
  emit('update:visible', false);
  emit('done');
}
</script>

<style scoped>
.log-container {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 6px;
  padding: 16px;
  min-height: 300px;
  max-height: 450px;
  overflow-y: auto;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.7;
}

.log-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 300px;
  color: #888;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-word;
  color: #ccc;
}

.log-highlight {
  color: #6abf69;
  font-weight: 600;
}

.log-status {
  margin-top: 12px;
}
</style>
