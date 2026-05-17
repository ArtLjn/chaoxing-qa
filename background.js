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

// ==================== System Prompt ====================

function buildSystemPrompt(type, blankCount) {
  if (type.includes('单选')) {
    return `你是考试答题助手。根据题目和选项给出正确答案。
必须且只能以如下 JSON 格式输出，禁止输出任何其他内容：
{"answer":"B"}`;
  }
  if (type.includes('多选')) {
    return `你是考试答题助手。根据题目和选项给出正确答案。
必须且只能以如下 JSON 格式输出，禁止输出任何其他内容：
{"answer":"ACD"}`;
  }
  if (type.includes('判断')) {
    return `你是考试答题助手。根据题目判断对错给出结果。
必须且只能以如下 JSON 格式输出，禁止输出任何其他内容：
{"answer":"对"}`;
  }
  if (type.includes('填空')) {
    let extra = '';
    if (blankCount > 0) {
      extra = `本题有${blankCount}个空，必须返回${blankCount}个答案用|分隔。`;
    }
    return `你是考试答题助手。根据题目填写正确答案。${extra}
必须且只能以如下 JSON 格式输出，禁止输出任何其他内容：
{"answer":"答案1|答案2"}`;
  }
  return `你是考试答题助手。根据题目给出正确答案。
必须且只能以如下 JSON 格式输出，禁止输出任何其他内容：
{"answer":"..."}`;
}

// ==================== 答案解析（核心：无论 AI 返回什么都尽力提取）====================

function parseAnswer(raw, type, blankCount) {
  if (!raw) return null;

  let text = raw.trim();

  // 第1步：尝试直接 JSON 解析
  try {
    const obj = JSON.parse(text);
    if (obj.answer !== undefined) {
      const v = validateAnswer(String(obj.answer).trim(), type, blankCount);
      if (v.valid) return v.answer;
    }
  } catch (e) { /* 不是纯 JSON，继续 */ }

  // 第2步：清理 markdown 代码块后再解析
  const cleaned = text.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj.answer !== undefined) {
      const v = validateAnswer(String(obj.answer).trim(), type, blankCount);
      if (v.valid) return v.answer;
    }
  } catch (e) { /* 继续 */ }

  // 第3步：从文本中找 {"answer":"xxx"} 模式
  const jsonMatch = text.match(/\{[\s\S]*?"answer"\s*:\s*"([^"]+)"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.answer !== undefined) {
        const v = validateAnswer(String(obj.answer).trim(), type, blankCount);
        if (v.valid) return v.answer;
      }
    } catch (e) { /* 继续 */ }
    // 正则捕获组兜底
    const v = validateAnswer(jsonMatch[1].trim(), type, blankCount);
    if (v.valid) return v.answer;
  }

  // 第4步：如果是 JSON 但用了单引号或没引号
  const looseMatch = text.match(/"answer"\s*:\s*"?([^",}\s]+)"?/);
  if (looseMatch) {
    const v = validateAnswer(looseMatch[1].trim(), type, blankCount);
    if (v.valid) return v.answer;
  }

  // 第5步：按题型从纯文本中提取
  if (type.includes('单选')) {
    // "答案是 B" / "选B" / 单独字母
    const m = text.match(/(?:答案|选|正确答案是)[：:\s]*([A-Z])\b/i);
    if (m) { const v = validateAnswer(m[1], type, blankCount); if (v.valid) return v.answer; }
    // 纯字母
    if (/^[A-Z]$/i.test(text.trim())) { const v = validateAnswer(text.trim().toUpperCase(), type, blankCount); if (v.valid) return v.answer; }
  }

  if (type.includes('多选')) {
    const m = text.match(/(?:答案|选)[：:\s]*([A-Z]{2,6})\b/i);
    if (m) { const v = validateAnswer(m[1], type, blankCount); if (v.valid) return v.answer; }
    if (/^[A-Z]{2,6}$/i.test(text.trim())) { const v = validateAnswer(text.trim().toUpperCase(), type, blankCount); if (v.valid) return v.answer; }
  }

  if (type.includes('判断')) {
    if (/^(对|错)$/.test(text)) { const v = validateAnswer(text, type, blankCount); if (v.valid) return v.answer; }
    if (/对|正确|true|yes/i.test(text) && !/错|错误|false|no/i.test(text)) return '对';
    if (/错|错误|false|no/i.test(text) && !/对|正确|true|yes/i.test(text)) return '错';
  }

  if (type.includes('填空')) {
    // 直接用原文，不做过多处理
    const v = validateAnswer(text, type, blankCount);
    if (v.valid) return v.answer;
  }

  return null;
}

// ==================== 格式校验 ====================

function validateAnswer(answer, type, blankCount) {
  const trimmed = answer.trim();

  if (type.includes('单选')) {
    if (/^[A-Z]$/i.test(trimmed)) return { valid: true, answer: trimmed.toUpperCase() };
    return { valid: false, reason: '单选题答案必须是单个字母' };
  }
  if (type.includes('多选')) {
    const upper = trimmed.toUpperCase();
    if (/^[A-Z]{2,6}$/.test(upper) && new Set(upper).size === upper.length) return { valid: true, answer: upper };
    return { valid: false, reason: '多选题答案必须是2-6个不重复字母' };
  }
  if (type.includes('判断')) {
    if (trimmed === '对' || trimmed === '错') return { valid: true, answer: trimmed };
    return { valid: false, reason: '判断题答案只能是对或错' };
  }
  if (type.includes('填空') && blankCount > 0) {
    const parts = trimmed.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length === blankCount) return { valid: true, answer: trimmed };
    return { valid: false, reason: `填空题需要${blankCount}个答案，得到${parts.length}个` };
  }
  if (trimmed.length > 0) return { valid: true, answer: trimmed };
  return { valid: false, reason: '答案不能为空' };
}

// ==================== API 调用 ====================

async function solveQuestion(title, options, type, blankCount) {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('未配置 API Key，请在设置中填入');
  }

  const baseUrl = settings.baseUrl.replace(/\/+$/, '');
  const url = baseUrl.includes('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;

  let userContent = `【题型】${type || '未知'}\n【题干】${title}\n`;
  if (options && options.length > 0) {
    userContent += '【选项】\n' + options.join('\n');
  }
  if ((type || '').includes('填空') && blankCount > 0) {
    userContent += `\n【空数】${blankCount} 个空`;
  }

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const systemPrompt = buildSystemPrompt(type || '', blankCount || 0);

    try {
      const startTime = Date.now();
      console.log(`[XXT BG] 请求开始 (第${attempt}次) model=${settings.model}`);

      // 尝试用 json_object 模式（部分模型支持）
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent }
            ],
            temperature: 0.1,
            max_tokens: (type || '').includes('填空') ? 256 : 50,
            response_format: { type: 'json_object' }
          })
        });
      } catch (fetchErr) {
        throw fetchErr;
      }

      // 如果 json_object 不支持，去掉 response_format 重试
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const errMsg = errBody.error?.message || '';

        if (errMsg.includes('response_format') || errMsg.includes('json_object') || errMsg.includes('json_schema')) {
          console.warn(`[XXT BG] 不支持 json_object，降级为普通模式`);
          response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${settings.apiKey}`
            },
            body: JSON.stringify({
              model: settings.model,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
              ],
              temperature: 0.1,
              max_tokens: (type || '').includes('填空') ? 256 : 50
            })
          });
        } else if (response.status === 429 || response.status >= 500) {
          if (attempt < maxRetries) {
            const retryDelay = 2000 * Math.pow(2, attempt - 1);
            console.warn(`[XXT BG] 第${attempt}次失败(${response.status}), ${retryDelay}ms后重试`);
            await new Promise(r => setTimeout(r, retryDelay));
            continue;
          }
          throw new Error(`<${response.status}> ${errMsg}`);
        } else {
          throw new Error(errMsg || `API 请求失败: ${response.status}`);
        }
      }

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        const errMsg = errBody.error?.message || `API 请求失败: ${response.status}`;
        if (attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
          const retryDelay = 2000 * Math.pow(2, attempt - 1);
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      const rawContent = data.choices[0].message.content.trim();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[XXT BG] 原始返回 (${elapsed}s): "${rawContent.substring(0, 100)}"`);

      // 解析答案（核心：无论返回什么格式都能提取）
      const answer = parseAnswer(rawContent, type || '', blankCount || 0);

      if (answer) {
        console.log(`[XXT BG] 解析成功: ${answer}`);
        return { answer };
      }

      console.warn(`[XXT BG] 第${attempt}次解析失败，原始内容: "${rawContent.substring(0, 80)}"`);

      if (attempt < maxRetries) {
        const retryDelay = 1500 * attempt;
        await new Promise(r => setTimeout(r, retryDelay));
      }

    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[XXT BG] 全部重试失败: ${err.message}`);
        throw new Error(`解答失败（重试 ${maxRetries} 次）: ${err.message}`);
      }
      const retryDelay = 2000 * Math.pow(2, attempt - 1);
      console.warn(`[XXT BG] 第${attempt}次异常, ${retryDelay}ms后重试: ${err.message}`);
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  throw new Error(`解答失败（重试 ${maxRetries} 次），无法获取有效答案`);
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
    solveQuestion(message.title, message.options, message.type, message.blankCount)
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
