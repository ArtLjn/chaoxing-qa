// popup.js - 设置页面逻辑

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyEl = document.getElementById('apiKey');
  const modelInputEl = document.getElementById('modelInput');
  const modelPresetEl = document.getElementById('modelPreset');
  const baseUrlEl = document.getElementById('baseUrl');
  const delayEl = document.getElementById('delay');
  const delayValueEl = document.getElementById('delayValue');
  const saveBtn = document.getElementById('save');
  const statusEl = document.getElementById('status');

  // 通过 background 获取设置
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  if (settings) {
    apiKeyEl.value = settings.apiKey || '';
    modelInputEl.value = settings.model || 'qwen-plus';
    baseUrlEl.value = settings.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    delayEl.value = settings.delay || 800;
    delayValueEl.textContent = ((settings.delay || 800) / 1000).toFixed(1);

    // 同步下拉框选中状态
    const presetOptions = [...modelPresetEl.options].map(o => o.value);
    if (presetOptions.includes(settings.model)) {
      modelPresetEl.value = settings.model;
    } else {
      modelPresetEl.value = '';
    }
  }

  // 快捷选择 → 填入输入框
  modelPresetEl.addEventListener('change', () => {
    if (modelPresetEl.value) {
      modelInputEl.value = modelPresetEl.value;
    }
  });

  // 手动输入时重置下拉框
  modelInputEl.addEventListener('input', () => {
    const presetOptions = [...modelPresetEl.options].map(o => o.value);
    if (!presetOptions.includes(modelInputEl.value)) {
      modelPresetEl.value = '';
    } else {
      modelPresetEl.value = modelInputEl.value;
    }
  });

  // 延迟滑动条实时显示
  delayEl.addEventListener('input', () => {
    delayValueEl.textContent = (delayEl.value / 1000).toFixed(1);
  });

  // 保存设置
  saveBtn.addEventListener('click', async () => {
    const model = modelInputEl.value.trim();
    if (!model) {
      statusEl.textContent = '请输入或选择模型';
      statusEl.className = '';
      statusEl.style.color = '#e74c3c';
      setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000);
      return;
    }

    const data = {
      apiKey: apiKeyEl.value.trim(),
      model: model,
      baseUrl: baseUrlEl.value.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      delay: parseInt(delayEl.value)
    };

    await chrome.runtime.sendMessage({ action: 'saveSettings', data });

    statusEl.textContent = '已保存';
    statusEl.className = 'success';
    statusEl.style.color = '';
    setTimeout(() => {
      statusEl.textContent = '';
      statusEl.className = '';
    }, 2000);
  });
});
