<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="连接 QQ 邮箱"
    width="480px"
    :close-on-click-modal="false"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
    >
      <el-alert
        title="QQ 邮箱需开启 IMAP/SMTP 服务并获取授权码"
        type="info"
        :closable="false"
        show-icon
        class="imap-alert"
      >
        <template #default>
          <p>请前往 QQ 邮箱 <b>设置 → 账户 → POP3/IMAP/SMTP 服务</b> 开启 IMAP，并使用<b>授权码</b>登录。</p>
        </template>
      </el-alert>

      <el-form-item label="服务器地址" prop="host">
        <el-input v-model="form.host" placeholder="imap.qq.com" />
      </el-form-item>

      <el-form-item label="端口" prop="port">
        <el-input-number v-model="form.port" :min="1" :max="65535" />
      </el-form-item>

      <el-form-item label="邮箱地址" prop="user">
        <el-input v-model="form.user" placeholder="your_email@qq.com" />
      </el-form-item>

      <el-form-item label="授权码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          placeholder="QQ 邮箱授权码 (非登录密码)"
        />
      </el-form-item>

      <el-form-item label="SSL/TLS">
        <el-switch v-model="form.tls" active-text="开启" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="loading" @click="handleFetch">
        获取邮件
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(['update:visible', 'fetch']);

const loading = ref(false);
const formRef = ref(null);

const form = reactive({
  host: 'imap.qq.com',
  port: 993,
  user: '',
  password: '',
  tls: true,
});

const rules = {
  host: [{ required: true, message: '请输入服务器地址', trigger: 'blur' }],
  port: [{ required: true, message: '请输入端口', trigger: 'blur' }],
  user: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '请输入有效的邮箱地址', trigger: 'blur' },
  ],
  password: [{ required: true, message: '请输入授权码', trigger: 'blur' }],
};

async function handleFetch() {
  if (!formRef.value) return;

  try {
    await formRef.value.validate();
    loading.value = true;
    emit('fetch', { ...form });
    emit('update:visible', false);
  } catch {
    ElMessage.warning('请完善连接信息');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.imap-alert {
  margin-bottom: 20px;
}

.imap-alert p {
  margin: 0;
  line-height: 1.6;
}
</style>
