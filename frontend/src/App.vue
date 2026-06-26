<template>
  <div class="app-container">
    <!-- 顶部导航 -->
    <header class="app-header">
      <div class="header-left">
        <el-icon :size="22" color="#409EFF"><Message /></el-icon>
        <h1>邮件数据分析智能体</h1>
      </div>
      <div class="header-right">
        <AnalysisSteps
          v-if="currentTaskId"
          :taskId="currentTaskId"
          :steps="analysisSteps"
          :status="analysisStatus"
          :progress="analysisProgress"
          inline
        />
        <el-button type="primary" @click="startFetchNew(1)">
          拉取单封新邮件
        </el-button>
        <el-button @click="startFetchNew(fetchLimit)">
          <el-icon><Download /></el-icon>
          拉取多封邮件
        </el-button>
      </div>
    </header>

    <!-- 三栏主体 -->
    <div class="app-body">
      <!-- 左栏：分类导航 -->
      <Sidebar
        :active-category="activeCategory"
        :total-count="allEmails.length"
        :category-counts="categoryCounts"
        @select-category="handleSelectCategory"
        @fetch="startFetchNew"
        @upload-eml="handleEmlUpload"
        @open-settings="showSettings = true"
        @clear-all="handleClearAll"
      />

      <!-- 中栏：邮件列表 -->
      <EmailList
        :emails="filteredEmails"
        :loading="imapLoading"
        :selected-uid="selectedEmail?.uid"
        @select="openDetail"
        @analyze="analyzeEmail"
        @deleted="onEmailDeleted"
      />

      <!-- 右栏：邮件详情 / AI 分析 -->
      <EmailDetail
        :email="selectedEmail"
        @export="handleExport"
        @fetch-raw="handleFetchRaw"
        @close="selectedEmail = null"
      />
    </div>

    <!-- 设置对话框 -->
    <SettingsDialog
      v-model:visible="showSettings"
      :settings="appSettings"
      @saved="loadSettings"
    />

    <!-- 拉取日志弹窗 -->
    <FetchLogDialog
      v-model:visible="showFetchLog"
      :limit="currentFetchSize"
      @done="loadEmails"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Message, Setting, Download } from '@element-plus/icons-vue';
import Sidebar from './components/Sidebar.vue';
import EmailList from './components/EmailList.vue';
import EmailDetail from './components/EmailDetail.vue';
import AnalysisSteps from './components/AnalysisSteps.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import FetchLogDialog from './components/FetchLogDialog.vue';
import http from './api';
import {
  uploadAndAnalyze, getAnalysisResult,
  fetchStoredEmails, fetchSettings, fetchRawEmail,
} from './api';
import { exportToJson } from './utils/export';

// ─── 状态 ────────────────────────────────────────────
const allEmails = ref([]);
const imapLoading = ref(false);
const activeCategory = ref('all');
const appSettings = ref({});
const showSettings = ref(false);
const showFetchLog = ref(false);
const currentFetchSize = ref(1);
const fetchLimit = ref(20);

const currentTaskId = ref(null);
const analysisSteps = ref([]);
const analysisStatus = ref('');
const analysisProgress = ref(0);
let sseConnection = null;

const selectedEmail = ref(null);
const selectedAnalysis = ref(null);

// ─── 计算属性 ────────────────────────────────────────
const filteredEmails = computed(() => {
  if (activeCategory.value === 'all') return allEmails.value;
  return allEmails.value.filter(
    (e) => e.analysis?.category === activeCategory.value
  );
});

const categoryCounts = computed(() => {
  const counts = {};
  for (const email of allEmails.value) {
    const cat = email.analysis?.category || '其他';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return counts;
});

// ─── 生命周期 ────────────────────────────────────────
onMounted(async () => {
  await loadSettings();
  await loadEmails();
});

async function loadSettings() {
  try {
    const res = await fetchSettings();
    if (res.success) {
      appSettings.value = res.settings;
      fetchLimit.value = parseInt(res.settings.fetch_limit || '20', 10);
    }
  } catch (err) { console.warn('加载设置失败:', err.message); }
}

async function loadEmails() {
  try {
    const data = await fetchStoredEmails();
    if (data.success) allEmails.value = data.emails || [];
  } catch (err) { console.warn('加载邮件失败:', err.message); }
}

function handleSelectCategory(category) {
  activeCategory.value = category;
  selectedEmail.value = null;
}

async function handleEmlUpload({ file }) {
  try {
    const { taskId } = await uploadAndAnalyze(file);
    ElMessage.success(`任务已创建: ${taskId}`);
    startSSEListener(taskId);
  } catch (err) {
    ElMessage.error('上传失败: ' + (err.response?.data?.message || err.message));
  }
}

async function analyzeEmail(email) {
  selectedEmail.value = email;
  const emlContent = [
    `From: ${email.from}`, `To: ${email.to}`,
    `Subject: ${email.subject}`, `Date: ${email.date}`,
    'Content-Type: text/plain; charset=utf-8', '',
    email.bodyPreview || '',
  ].join('\r\n');
  const blob = new Blob([emlContent], { type: 'message/rfc822' });
  const file = new File([blob], `email_${email.uid}.eml`, { type: 'message/rfc822' });
  try {
    const { taskId } = await uploadAndAnalyze(file);
    ElMessage.success(`分析已启动: ${taskId}`);
    startSSEListener(taskId);
  } catch (err) {
    ElMessage.error('分析启动失败: ' + (err.response?.data?.message || err.message));
  }
}

function startSSEListener(taskId) {
  if (sseConnection) sseConnection.close();
  currentTaskId.value = taskId;
  sseConnection = new EventSource(`/api/analyze/${taskId}/stream`);
  sseConnection.onmessage = (event) => {
    const data = JSON.parse(event.data);
    analysisStatus.value = data.status;
    analysisProgress.value = data.progress;
    analysisSteps.value = data.steps || [];
    if (data.result) {
      sseConnection.close(); sseConnection = null;
      handleAnalysisResult(data.result);
      return;
    }
    if (data.status === 'failed') {
      sseConnection.close(); sseConnection = null;
      ElMessage.error('分析失败: ' + (data.error || '未知错误'));
    }
  };
  sseConnection.onerror = () => {
    if (sseConnection?.readyState === EventSource.CLOSED) sseConnection = null;
  };
}

function handleAnalysisResult(result) {
  ElMessage.success('分析完成！');
  const updated = {
    ...(result.email || {}),
    uid: result.email?.messageId || '',
    analysis: result.analysis,
  };
  // 更新列表中的邮件
  const idx = allEmails.value.findIndex((e) => e.uid === updated.uid);
  if (idx >= 0) allEmails.value[idx] = updated;
  selectedEmail.value = updated;
  loadEmails();
}

function startFetchNew(limit) {
  if (limit) currentFetchSize.value = limit;
  showFetchLog.value = true;
}

async function handleClearAll() {
  try {
    await ElMessageBox.confirm('确定清空所有邮件数据？此操作不可撤销。', '确认清空', {
      type: 'error', confirmButtonText: '清空', cancelButtonText: '取消',
    });
    await http.delete('/emails/all');
    allEmails.value = [];
    selectedEmail.value = null;
    ElMessage.success('系统已清空');
  } catch (err) {
    if (err !== 'cancel') ElMessage.error('清空失败');
  }
}

function openDetail(email) { selectedEmail.value = email; }

function onEmailDeleted() {
  selectedEmail.value = null;
  loadEmails();
}

async function handleFetchRaw(uid) {
  try {
    const data = await fetchRawEmail(uid);
    if (data.success && selectedEmail.value) {
      selectedEmail.value = {
        ...selectedEmail.value,
        bodyPreview: data.bodyFull || data.bodyPreview,
      };
    }
  } catch (err) { console.error(err); }
}

function handleExport(data) {
  exportToJson(data, `email-analysis-${Date.now()}.json`);
  ElMessage.success('导出成功');
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; overflow: hidden; }
#app { height: 100vh; }
.app-container { height: 100vh; display: flex; flex-direction: column; }
.app-header {
  height: 48px; padding: 0 16px; background: #fff;
  border-bottom: 1px solid #e4e7ed; display: flex;
  align-items: center; justify-content: space-between; flex-shrink: 0;
}
.header-left { display: flex; align-items: center; gap: 10px; }
.header-left h1 { font-size: 16px; font-weight: 600; color: #303133; }
.header-right { display: flex; align-items: center; gap: 12px; }
.app-body { flex: 1; display: flex; overflow: hidden; }
</style>
