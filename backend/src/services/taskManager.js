/**
 * 异步任务管理器
 * - 使用 Worker Threads 处理耗时任务
 * - Map 存储任务状态
 * - SSE 客户端管理
 */
const { Worker } = require('worker_threads');
const path = require('path');
const config = require('../config');
const { saveParsedEmail, attachAnalysis } = require('./emailStore');

// ─── 任务存储 ─────────────────────────────────────────
const taskStore = new Map();

// ─── SSE 客户端存储 (每个任务对应的响应对象列表) ──────
const sseClients = new Map();

/**
 * 创建新任务
 * @param {Object} params - 任务参数 { filePath, options }
 * @returns {string} taskId
 */
function createTask(params) {
  const taskId = generateTaskId();

  const task = {
    id: taskId,
    status: 'queued',           // queued | parsing | analyzing | done | failed
    progress: 0,                // 0-100
    steps: [
      { title: '解析邮件文件', status: 'wait', description: '读取并解析 .eml 文件' },
      { title: '解析PDF附件',  status: 'wait', description: '提取 PDF 附件中的文本内容' },
      { title: 'AI 智能分析',  status: 'wait', description: '调用 DeepSeek 生成摘要与分类' },
      { title: '生成结果',     status: 'wait', description: '汇总分析结果' },
    ],
    result: null,
    error: null,
    createdAt: Date.now(),
    filePath: params.filePath,
  };

  taskStore.set(taskId, task);

  // 启动 Worker 处理
  startWorker(taskId, params);

  return taskId;
}

/**
 * 启动 Worker Thread 处理任务
 */
function startWorker(taskId, params) {
  const workerPath = path.join(__dirname, '..', 'workers', 'analyzeWorker.js');

  const worker = new Worker(workerPath, {
    workerData: {
      taskId,
      filePath: params.filePath,
    },
  });

  worker.on('message', (msg) => {
    handleWorkerMessage(taskId, msg);
  });

  worker.on('error', (err) => {
    updateTask(taskId, {
      status: 'failed',
      error: err.message,
    });
    notifySSEClients(taskId);
    taskStore.get(taskId)._worker = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      const task = taskStore.get(taskId);
      if (task && task.status !== 'done') {
        updateTask(taskId, {
          status: 'failed',
          error: `Worker 异常退出 (code: ${code})`,
        });
        notifySSEClients(taskId);
      }
    }
  });

  // 将 worker 引用存入 task
  const task = taskStore.get(taskId);
  if (task) {
    task._worker = worker;
  }
}

/**
 * 处理 Worker 发来的消息
 */
function handleWorkerMessage(taskId, msg) {
  const { type, data } = msg;
  console.log(`[TaskManager] 收到 Worker 消息: type=${type}, taskId=${taskId}`);

  switch (type) {
    case 'progress':
      // 进度更新
      updateTask(taskId, {
        status: data.status,
        progress: data.progress,
        steps: data.steps,
      });
      break;

    case 'result':
      // 任务完成
      updateTask(taskId, {
        status: 'done',
        progress: 100,
        steps: data.steps,
        result: data.result,
      });
      // 将分析结果持久化到 SQLite
      try {
        if (data.result?.email) {
          saveParsedEmail(data.result.email);
        }
        if (data.result?.email?.messageId && data.result?.analysis) {
          attachAnalysis(data.result.email.messageId, data.result.analysis);
        }
      } catch (dbErr) {
        console.error('[TaskManager] 数据库写入失败:', dbErr.message);
      }
      break;

    case 'error':
      // 任务失败
      updateTask(taskId, {
        status: 'failed',
        error: data.message,
      });
      break;
  }

  // 通知所有 SSE 客户端
  notifySSEClients(taskId);
}

/**
 * 更新任务数据 (部分合并)
 */
function updateTask(taskId, updates) {
  const task = taskStore.get(taskId);
  if (task) {
    Object.assign(task, updates);
  }
}

/**
 * 注册 SSE 客户端
 */
function addSSEClient(taskId, res) {
  if (!sseClients.has(taskId)) {
    sseClients.set(taskId, new Set());
  }
  sseClients.get(taskId).add(res);

  // 客户端断开时清理
  res.on('close', () => {
    const clients = sseClients.get(taskId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(taskId);
      }
    }
  });
}

/**
 * 向所有 SSE 客户端推送当前任务状态
 */
function notifySSEClients(taskId) {
  const task = taskStore.get(taskId);
  if (!task) return;

  const clients = sseClients.get(taskId);
  if (!clients) return;

  const payload = formatSSEData(task);

  for (const res of clients) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

/**
 * 格式化 SSE 推送数据
 */
function formatSSEData(task) {
  return {
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    steps: task.steps,
    // 仅在完成时返回完整结果
    result: task.status === 'done' ? task.result : null,
    error: task.status === 'failed' ? task.error : null,
    timestamp: Date.now(),
  };
}

/**
 * 获取任务
 */
function getTask(taskId) {
  return taskStore.get(taskId) || null;
}

/**
 * 生成唯一任务 ID
 */
function generateTaskId() {
  const { v4: uuidv4 } = require('uuid');
  return uuidv4().substring(0, 8);
}

/**
 * 清理过期任务
 */
function taskCleanupScheduler() {
  setInterval(() => {
    const now = Date.now();
    const toDelete = [];

    for (const [id, task] of taskStore) {
      if (now - task.createdAt > config.TASK_MAX_AGE) {
        // 终止可能还在运行的 worker
        if (task._worker) {
          task._worker.terminate().catch(() => {});
        }
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      taskStore.delete(id);
      sseClients.delete(id);
    }

    if (toDelete.length > 0) {
      console.log(`🧹 清理了 ${toDelete.length} 个过期任务`);
    }
  }, config.TASK_CLEANUP_INTERVAL);
}

module.exports = {
  createTask,
  getTask,
  addSSEClient,
  updateTask,
  taskCleanupScheduler,
};
