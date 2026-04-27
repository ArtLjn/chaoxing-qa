// background.js - Service Worker，处理阿里百炼 API 调用

const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'qwen-plus',
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  delay: 800
};

async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// 答案缓存（内存中，同一次插件生命周期内有效）
const answerCache = new Map();

function getCacheKey(title, options) {
  return title + '|' + (options || []).join('|');
}

const SYSTEM_PROMPT = `根据题目和选项给出正确答案，只返回答案本身。
规则：选择题只返回字母如A或AB，判断题返回对或错，填空题返回答案文本，多个空用|分隔。不要输出任何多余内容。`;

// 调用 API 解答单题
async function solveQuestion(title, options, type) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('未配置 API Key，请在设置中填入');
  }

  let userContent = `【题型】${type || '未知'}\n【题干】${title}\n`;
  if (options && options.length > 0) {
    userContent += '【选项】\n' + options.join('\n');
  }

  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const url = baseUrl.includes('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent }
          ],
          temperature: 0.1,
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const errMsg = errBody.error?.message || `API 请求失败: ${response.status}`;
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`<${response.status}> ${errMsg}`);
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      return parseAIResponse(content);
    } catch (err) {
      if (attempt === maxRetries) {
        throw new Error(`解答失败（重试 ${maxRetries} 次）: ${err.message}`);
      }
      const retryDelay = 2000 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
}

function parseAIResponse(content) {
  return { answer: content.trim() };
}

// Service Worker 保活
chrome.alarms?.create('keepalive', { periodInMinutes: 0.4 });
chrome.alarms?.onAlarm.addListener(() => {});

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'solve') {
    const cacheKey = getCacheKey(message.title, message.options);
    const cached = answerCache.get(cacheKey);
    if (cached) {
      sendResponse({ ...cached, cached: true });
      return;
    }
    solveQuestion(message.title, message.options, message.type)
      .then(result => {
        answerCache.set(cacheKey, result);
        sendResponse({ ...result, cached: false });
      })
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.action === 'saveSettings') {
    saveSettings(message.data).then(() => sendResponse({ success: true }));
    return true;
  }
});
