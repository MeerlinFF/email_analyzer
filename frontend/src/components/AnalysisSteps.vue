<template>
  <!-- 内联模式：header 中的精简进度 -->
  <div v-if="inline && taskId" class="inline-steps">
    <el-icon :color="statusIcon.color" :class="{ 'is-loading': statusIcon.loading }">
      <component :is="statusIcon.icon" />
    </el-icon>
    <el-progress :percentage="progress" :stroke-width="4" :show-text="false" style="width:100px" />
    <el-tag :type="statusTagType" size="small">{{ statusLabel }}</el-tag>
  </div>

  <!-- 完整卡片模式 -->
  <el-card v-else-if="taskId" class="steps-card" shadow="never">
    <template #header>
      <div class="card-header">
        <span class="card-title">
          <el-icon :color="statusIcon.color" :class="{ 'is-loading': statusIcon.loading }">
            <component :is="statusIcon.icon" />
          </el-icon>
          分析进度
        </span>
        <el-tag :type="statusTagType" size="small">
          {{ statusLabel }}
        </el-tag>
      </div>
    </template>

    <!-- 进度条 -->
    <el-progress
      :percentage="progress"
      :status="progress === 100 ? 'success' : progress > 0 ? '' : undefined"
      :stroke-width="8"
    />

    <!-- 步骤条 -->
    <el-steps
      v-if="steps.length"
      :active="activeStep"
      align-center
      finish-status="success"
      process-status="process"
      class="analysis-steps"
    >
      <el-step
        v-for="(step, idx) in steps"
        :key="idx"
        :title="step.title"
        :description="step.description"
        :status="getStepStatus(step.status)"
      />
    </el-steps>

    <!-- 错误信息 -->
    <el-alert
      v-if="status === 'failed'"
      title="分析失败"
      type="error"
      :closable="false"
      show-icon
      class="error-alert"
    />
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { Loading, CircleCheck, CircleClose } from '@element-plus/icons-vue';

const props = defineProps({
  taskId: String,
  steps: { type: Array, default: () => [] },
  status: { type: String, default: '' },
  progress: { type: Number, default: 0 },
  inline: { type: Boolean, default: false },
});

const statusTagType = computed(() => {
  if (props.status === 'done') return 'success';
  if (props.status === 'failed') return 'danger';
  return 'warning';
});

const statusLabel = computed(() => {
  const map = {
    queued: '排队中',
    parsing: '解析中',
    analyzing: 'AI 分析中',
    done: '已完成',
    failed: '失败',
  };
  return map[props.status] || props.status;
});

const statusIcon = computed(() => {
  if (props.status === 'done') return { icon: CircleCheck, color: '#67C23A', loading: false };
  if (props.status === 'failed') return { icon: CircleClose, color: '#F56C6C', loading: false };
  return { icon: Loading, color: undefined, loading: true };
});

const activeStep = computed(() => {
  const idx = props.steps.findIndex((s) => s.status === 'process');
  if (idx >= 0) return idx;
  const finishCount = props.steps.filter((s) => s.status === 'finish').length;
  return finishCount;
});

function getStepStatus(s) {
  if (s === 'finish') return 'success';
  if (s === 'process') return 'process';
  if (s === 'error') return 'error';
  return 'wait';
}
</script>

<style scoped>
.inline-steps {
  display: flex; align-items: center; gap: 8px;
}
.steps-card {
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

.is-loading {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.analysis-steps {
  margin-top: 20px;
}

.error-alert {
  margin-top: 16px;
}
</style>
