<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="设置"
    width="560px"
    :close-on-click-modal="false"
  >
    <el-tabs v-model="activeTab">
      <!-- ── IMAP 设置 ── -->
      <el-tab-pane label="邮箱连接" name="imap">
        <el-form :model="imap" label-width="100px" size="default">
          <el-form-item label="IMAP 服务器">
            <el-input v-model="imap.host" placeholder="imap.qq.com" />
          </el-form-item>
          <el-form-item label="端口">
            <el-input-number v-model="imap.port" :min="1" :max="65535" />
          </el-form-item>
          <el-form-item label="邮箱地址">
            <el-input v-model="imap.user" placeholder="your_email@qq.com" />
          </el-form-item>
          <el-form-item label="授权码">
            <el-input
              v-model="imap.password"
              type="password"
              show-password
              placeholder="QQ 邮箱授权码"
            />
          </el-form-item>
          <el-form-item label="SSL/TLS">
            <el-switch v-model="imap.tls" />
          </el-form-item>
          <el-form-item label="拉取数量">
            <el-input-number v-model="imap.limit" :min="5" :max="200" :step="5" />
            <span class="form-tip">「拉取多封」时 AI 分析的邮件数量</span>
          </el-form-item>
          <el-alert
            title="提示"
            type="info"
            :closable="false"
            show-icon
          >
            QQ 邮箱需在 设置 → 账户 → POP3/IMAP/SMTP 服务 中开启 IMAP，并使用授权码登录。
          </el-alert>
        </el-form>
      </el-tab-pane>

      <!-- ── LLM 设置 ── -->
      <el-tab-pane label="AI 大模型" name="llm">
        <el-form :model="llm" label-width="100px" size="default">
          <el-form-item label="API Key">
            <el-input
              v-model="llm.apiKey"
              type="password"
              show-password
              placeholder="sk-..."
            />
          </el-form-item>
          <el-form-item label="接口地址">
            <el-input v-model="llm.baseUrl" placeholder="https://api.deepseek.com" />
          </el-form-item>
          <el-form-item label="模型名称">
            <el-input v-model="llm.model" placeholder="deepseek-chat" />
          </el-form-item>
          <el-alert
            title="支持兼容 OpenAI 接口的大模型"
            type="info"
            :closable="false"
            show-icon
          >
            默认使用 DeepSeek。也可配置其他兼容接口 (如 OpenAI、本地模型等)。
          </el-alert>
        </el-form>
      </el-tab-pane>
    </el-tabs>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">
        保存设置
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { updateSettings } from '../api';

const props = defineProps({
  visible: Boolean,
  settings: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['update:visible', 'saved']);

const activeTab = ref('imap');
const saving = ref(false);

const imap = reactive({
  host: 'imap.qq.com',
  port: 993,
  user: '',
  password: '',
  tls: true,
  limit: 20,
});

const llm = reactive({
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
});

// 填充已有设置
watch(
  () => props.visible,
  (val) => {
    if (val && props.settings) {
      imap.host = props.settings.imap_host || 'imap.qq.com';
      imap.port = parseInt(props.settings.imap_port || '993', 10);
      imap.user = props.settings.imap_user || '';
      imap.password = props.settings.imap_password || '';
      imap.tls = (props.settings.imap_tls || 'true') !== 'false';
      imap.limit = parseInt(props.settings.fetch_limit || '20', 10);

      llm.apiKey = props.settings.llm_api_key || '';
      llm.baseUrl = props.settings.llm_base_url || 'https://api.deepseek.com';
      llm.model = props.settings.llm_model || 'deepseek-chat';
    }
  },
  { immediate: true }
);

async function handleSave() {
  saving.value = true;
  try {
    await updateSettings({
      imap_host: imap.host,
      imap_port: String(imap.port),
      imap_user: imap.user,
      imap_password: imap.password,
      imap_tls: String(imap.tls),
      fetch_limit: String(imap.limit),
      llm_api_key: llm.apiKey,
      llm_base_url: llm.baseUrl,
      llm_model: llm.model,
    });
    ElMessage.success('设置已保存');
    emit('saved');
    emit('update:visible', false);
  } catch (err) {
    ElMessage.error('保存失败: ' + (err.response?.data?.message || err.message));
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.form-tip {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
</style>
