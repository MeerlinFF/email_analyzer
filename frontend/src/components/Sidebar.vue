<template>
  <div class="sidebar">
    <!-- 顶部操作 -->
    <div class="sidebar-actions">
      <el-upload
        :show-file-list="false"
        accept=".eml"
        :http-request="handleUpload"
      >
        <el-button size="small">
          <el-icon><Upload /></el-icon>
          导入 EML
        </el-button>
      </el-upload>
      <el-button size="small" type="danger" plain @click="$emit('clearAll')">
        <el-icon><Delete /></el-icon>
        清空系统
      </el-button>
    </div>

    <!-- 分类导航 -->
    <el-menu
      :default-active="activeCategory"
      class="category-menu"
      @select="$emit('selectCategory', $event)"
    >
      <el-menu-item index="all">
        <el-icon><Message /></el-icon>
        <span>收件箱</span>
        <el-tag size="small" class="count-tag">{{ totalCount }}</el-tag>
      </el-menu-item>

      <el-menu-item
        v-for="cat in categories"
        :key="cat.key"
        :index="cat.key"
      >
        <el-icon><component :is="cat.icon" /></el-icon>
        <span>{{ cat.label }}</span>
        <el-tag :type="cat.tagType" size="small" class="count-tag">
          {{ cat.count }}
        </el-tag>
      </el-menu-item>
    </el-menu>

    <!-- 底部设置 -->
    <div class="sidebar-footer">
      <el-button text class="settings-btn" @click="$emit('openSettings')">
        <el-icon><Setting /></el-icon>
        设置
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import {
  Message, Setting, Upload, Delete,
  Briefcase, Notification, Money, Calendar, ShoppingBag, Warning, Key,
} from '@element-plus/icons-vue';

const props = defineProps({
  activeCategory: { type: String, default: 'all' },
  totalCount: { type: Number, default: 0 },
  categoryCounts: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['selectCategory', 'fetch', 'uploadEml', 'openSettings', 'clearAll']);
function handleUpload(req) { emit('uploadEml', req); }

const categories = computed(() => [
  { key: '工作/商务', label: '工作',  icon: Briefcase,   tagType: 'primary',  count: props.categoryCounts['工作/商务'] || 0 },
  { key: '个人/私人', label: '个人',  icon: Key,          tagType: 'info',     count: props.categoryCounts['个人/私人'] || 0 },
  { key: '通知/公告', label: '通知',  icon: Notification, tagType: 'warning',  count: props.categoryCounts['通知/公告'] || 0 },
  { key: '财务/账单', label: '财务',  icon: Money,        tagType: 'danger',   count: props.categoryCounts['财务/账单'] || 0 },
  { key: '推广/营销', label: '推广',  icon: ShoppingBag,  tagType: 'warning',  count: props.categoryCounts['推广/营销'] || 0 },
  { key: '会议/日程', label: '会议',  icon: Calendar,     tagType: 'success',  count: props.categoryCounts['会议/日程'] || 0 },
  { key: '技术支持', label: '技术',  icon: Setting,      tagType: 'primary',  count: props.categoryCounts['技术支持'] || 0 },
  { key: '紧急/重要', label: '紧急',  icon: Warning,      tagType: 'danger',   count: props.categoryCounts['紧急/重要'] || 0 },
  { key: '其他',     label: '其他',  icon: Message,      tagType: 'info',     count: props.categoryCounts['其他'] || 0 },
]);

</script>

<style scoped>
.sidebar {
  width: 200px;
  height: 100%;
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.sidebar-actions {
  padding: 12px;
  display: flex;
  gap: 8px;
}

.fetch-btn {
  flex: 1;
}

.upload-btn {
  width: 32px;
  padding: 0;
}

.category-menu {
  flex: 1;
  border-right: none;
}

.count-tag {
  margin-left: auto;
}

.sidebar-footer {
  padding: 12px;
  border-top: 1px solid #e4e7ed;
}

.settings-btn {
  width: 100%;
  justify-content: flex-start;
  color: #606266;
}
</style>
