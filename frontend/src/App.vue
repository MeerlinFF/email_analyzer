<template>
  <div class="app-container">
    <!-- 顶部导航 -->
    <header class="app-header">
      <div class="header-left">
        <el-icon :size="24" color="#409EFF"><Message /></el-icon>
        <h1>邮件数据分析智能体</h1>
      </div>
      <div class="header-right">
        <el-button type="primary" size="small" @click="startFetchNew">
          <el-icon><Download /></el-icon>
          拉取新邮件
        </el-button>
      </div>
    </header>

    <!-- 主体：左侧边栏 + 右侧内容 -->
    <div class="app-body">
      <Sidebar
        :active-category="activeCategory"
        :total-count="allEmails.length"
        :category-counts="categoryCounts"
        @select-category="handleSelectCategory"
        @fetch="handleFetch"
        @upload-eml="handleEmlUpload"
        @open-settings="showSettings = true"
      />

      <!-- 右侧主区域 -->
      <div class="main-content">
        <AnalysisSteps
          v-if="currentTaskId"
          :taskId="currentTaskId"
          :steps="analysisSteps"
          :status="analysisStatus"
          :progress="analysisProgress"
        />

        <EmailList
          :emails="filteredEmails"
          :loading="imapLoading"
          @view-detail="openDetail"
          @analyze="analyzeEmail"
          @deleted="loadEmails"
        />
      </div>
    </div>

    <!-- 邮件详情抽屉 -->
    <EmailDetail
      v-model:visible="detailVisible"
      :email="selectedEmail"
      :analysis="selectedAnalysis"
      @export="handleExport"
      @fetch-raw="handleFetchRaw"
    />

    <!-- 设置对话框 -->
    <SettingsDialog
      v-model:visible="showSettings"
      :settings="appSettings"
      @saved="loadSettings"
    />

    <!-- 拉取日志弹窗 -->
    <FetchLogDialog
      v-model:visible="showFetchLog"
      @done="loadEmails"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Message, Setting, Download } from '@element-plus/icons-vue';
import Sidebar from './components/Sidebar.vue';
import EmailList from './components/EmailList.vue';
import EmailDetail from './components/EmailDetail.vue';
import AnalysisSteps from './components/AnalysisSteps.vue';
import SettingsDialog from './components/SettingsDialog.vue';
import FetchLogDialog from './components/FetchLogDialog.vue';
import {
  uploadAndAnalyze, getAnalysisResult,
  fetchImapEmails, fetchStoredEmails,
  fetchSettings, fetchRawEmail,
} from './api';
import { exportToJson } from './utils/export';

// ─── 状态 ────────────────────────────────────────────
const allEmails = ref([]);
const imapLoading = ref(false);
const activeCategory = ref('all');
const appSettings = ref({});
const showSettings = ref(false);
const showFetchLog = ref(false);

const currentTaskId = ref(null);
const analysisSteps = ref([]);
const analysisStatus = ref('');
const analysisProgress = ref(0);
let sseConnection = null;

const detailVisible = ref(false);
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
    if (res.success) appSettings.value = res.settings;
  } catch (err) { console.warn('加载设置失败:', err.message); }
}

async function loadEmails() {
  try {
    const data = await fetchStoredEmails();
    if (data.success) allEmails.value = data.emails || [];
  } catch (err) { console.warn('加载邮件失败:', err.message); }
}

// ─── 分类切换 (纯前端过滤，不重新请求) ────────────────
function handleSelectCategory(category) {
  activeCategory.value = category;
}

// ─── 拉取邮件 ────────────────────────────────────────
async function handleFetch() {
  imapLoading.value = true;
  try {
    const data = await fetchImapEmails({});
    allEmails.value = data.emails || [];
    const msg = data.newCount > 0
      ? `获取成功: ${allEmails.value.length} 封 (新增 ${data.newCount} 封)`
      : `已同步 ${allEmails.value.length} 封 (无新增)`;
    ElMessage.success(msg);
  } catch (err) {
    ElMessage.error('获取失败: ' + (err.response?.data?.message || err.message));
  } finally { imapLoading.value = false; }
}

// ─── 上传 EML ────────────────────────────────────────
async function handleEmlUpload({ file }) {
  try {
    const { taskId } = await uploadAndAnalyze(file);
    ElMessage.success(`任务已创建: ${taskId}`);
    startSSEListener(taskId);
  } catch (err) {
    ElMessage.error('上传失败: ' + (err.response?.data?.message || err.message));
  }
}

// ─── AI 分析 ─────────────────────────────────────────
async function analyzeEmail(email) {
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

// ─── SSE ─────────────────────────────────────────────
function startSSEListener(taskId) {
  if (sseConnection) sseConnection.close();
  currentTaskId.value = taskId;
  sseConnection = new EventSource(`/api/analyze/${taskId}/stream`);

  sseConnection.onmessage = (event) => {
    const data = JSON.parse(event.data);
    analysisStatus.value = data.status;
    analysisProgress.value = data.progress;
    analysisSteps.value = data.steps || [];

    // 拿到 result 直接展示，不依赖 status
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

// 统一处理分析结果
function handleAnalysisResult(result) {
  ElMessage.success('分析完成！');
  selectedAnalysis.value = result;
  selectedEmail.value = {
    ...(result.email || {}),
    uid: result.email?.messageId || '',
    analysis: result.analysis,
  };
  loadEmails(); // 刷新邮件列表
}

async function fetchFullResult(taskId) {
  try {
    const data = await getAnalysisResult(taskId);
    if (data.success && data.result) {
      selectedAnalysis.value = data.result;
      selectedEmail.value = {
        ...data.result.email,
        uid: data.result.email?.messageId || '',
        analysis: data.result.analysis,
      };
      await loadEmails();
    }
  } catch (err) { console.error('获取结果失败:', err); }
}

// ─── 拉取新邮件 ────────────────────────────────────────
function startFetchNew() {
  showFetchLog.value = true;
}

// ─── 详情 ────────────────────────────────────────────
function openDetail(email) {
  selectedEmail.value = email;
  detailVisible.value = true;
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

// ─── 导出 ────────────────────────────────────────────
function handleExport(data) {
  exportToJson(data, `email-analysis-${Date.now()}.json`);
  ElMessage.success('导出成功');
}
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  overflow: hidden;
}

#app { height: 100vh; }

.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  height: 52px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-left h1 {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
</style>
