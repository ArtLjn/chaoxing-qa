// content.js - 注入学习通作业页面，提取题目 + 浮窗显示答案

(function () {
  'use strict';

  // 防止重复注入
  if (window.__xxtSearcherLoaded) return;
  window.__xxtSearcherLoaded = true;

  let isSearching = false;
  let currentIndex = 0;
  let totalCount = 0;
  // 记录每题结果
  const questionResults = new Map();

  // 前端答案缓存（localStorage 持久化）
  const CACHE_KEY = 'xxt_answer_cache';

  function loadCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    } catch { return {}; }
  }

  function saveCache(cache) {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  function getCacheAnswer(title) {
    const cache = loadCache();
    return cache[title] || null;
  }

  function setCacheAnswer(title, answer) {
    const cache = loadCache();
    cache[title] = answer;
    saveCache(cache);
  }

  // ==================== 通信工具 ====================

  function sendToBackground(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  // ==================== 题目提取 ====================

  async function extractQuestions() {
    const questions = [];
    let qList = document.querySelectorAll('div[id^="question"].questionLi');
    if (qList.length === 0) qList = document.querySelectorAll('div[id^="question"]');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.newTiMu');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.divQuestion');
    if (qList.length === 0) qList = document.querySelectorAll('.divQuestion');

    for (let idx = 0; idx < qList.length; idx++) {
      const q = await extractOneQuestion(qList[idx], idx);
      if (q.title.trim()) questions.push(q);
    }

    return questions;
  }

  async function extractOneQuestion(el, index) {
    const question = {
      index: index + 1,
      type: '',
      title: '',
      options: [],
      element: el,
      answered: false
    };

    question.answered = isAlreadyAnswered(el);

    // --- 提取题型 + 题干 ---
    // 方式1: 作业页 dowork 结构 (h3.mark_name > span.colorShallow)
    const h3 = el.querySelector('h3.mark_name, .mark_name, h3[class*="mark"]');
    if (h3) {
      const typeSpan = h3.querySelector('span.colorShallow, .colorShallow');
      if (typeSpan) {
        question.type = typeSpan.textContent.trim().replace(/[()（）\[\]【】]/g, '');
      }
      let titleText = h3.textContent;
      titleText = titleText.replace(/^\s*\d+\s*[.．、]\s*/, '');
      titleText = titleText.replace(/[\[【\(（]?(单选题|多选题|判断题|填空题|简答题)[\]】\)）]?/g, '');
      titleText = titleText.replace(/\s+/g, ' ').trim();
      question.title = titleText;
    }

    // 方式2: 课程内测页 doHomeWorkNew 结构 (div.Zy_TItle > span.newZy_TItle)
    if (!question.title) {
      const zyTitle = el.querySelector('div.Zy_TItle');
      if (zyTitle) {
        const typeSpan = zyTitle.querySelector('span.newZy_TItle');
        if (typeSpan) {
          question.type = typeSpan.textContent.trim().replace(/[\[【\(（）\]\)】]/g, '');
        }
        // 题干在 div.fontLabel 或直接在 Zy_TItle 下
        const titleDiv = zyTitle.querySelector('div.fontLabel, div[class*="fontLabel"]') || zyTitle.querySelector('div.clearfix');
        if (titleDiv) {
          let titleText = titleDiv.textContent;
          titleText = titleText.replace(/[\[【\(（]?(单选题|多选题|判断题|填空题|简答题)[\]】\)）]?/g, '');
          titleText = titleText.replace(/\s+/g, ' ').trim();
          question.title = titleText;
        }
      }
    }

    // 备用：从整体文本提取
    if (!question.title) {
      const allText = el.textContent;
      const match = allText.match(/(?:\d+[.．、]\s*)?[\[【\(（]?(单选题|多选题|判断题|填空题|简答题)[\]】\)）]?\s*(.+)/);
      if (match) {
        question.type = match[1];
        question.title = match[2].replace(/\s+/g, ' ').trim();
      }
    }

    // --- 提取选项 ---
    // 方式1: 作业页 dowork 结构 (div.answerBg)
    const optionEls = el.querySelectorAll('div.answerBg');
    optionEls.forEach(optEl => {
      const letterSpan = optEl.querySelector('span.num_option');
      const letter = letterSpan ? letterSpan.getAttribute('data') || letterSpan.textContent.trim() : '';
      let optText = optEl.textContent.trim().replace(/\s+/g, ' ');
      if (optText) question.options.push(optText);
    });

    // 方式2: 课程内测页 doHomeWorkNew 结构 (ul.Zy_ulTop > li)
    if (question.options.length === 0) {
      const liOptions = el.querySelectorAll('ul.Zy_ulTop li, ul.Zy_ulTop > li');
      liOptions.forEach(li => {
        const letterSpan = li.querySelector('span.num_option');
        const letter = letterSpan ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()) : '';
        // 选项文本在 <a> 标签里
        const aTag = li.querySelector('a.after, a[class*="after"]');
        const optText = aTag ? aTag.textContent.trim() : li.textContent.replace(letter, '').trim();
        if (letter || optText) {
          question.options.push(letter + '. ' + optText);
        }
      });
    }

    // 备用选项提取
    if (question.options.length === 0) {
      const altOptions = el.querySelectorAll('li, label');
      altOptions.forEach(opt => {
        const optText = opt.textContent.trim();
        if (optText && /^[A-Z][、.．\s]/.test(optText)) {
          question.options.push(optText);
        }
      });
    }

    // 如果仍没识别题型，根据内容推断
    if (!question.type) {
      question.type = guessQuestionType(el, question.options);
    }

    // --- 识别题目中的图片内容（公式、图表等） ---
    if (window.xxtOcr && window.xxtOcr.isReady()) {
      const hasImgInTitle = el.querySelector('h3.mark_name img, div.Zy_TItle img, div.fontLabel img, div.stem_answer div.clearfix img');
      const hasImgInOptions = el.querySelector('div.answerBg img, ul.Zy_ulTop li img');
      if (hasImgInTitle || hasImgInOptions) {
        try {
          // 题干中的图片
          if (hasImgInTitle) {
            const titleContainer = el.querySelector('h3.mark_name, div.Zy_TItle div.fontLabel, div.Zy_TItle div.clearfix, div.stem_answer div.clearfix');
            if (titleContainer) {
              const imgText = await window.xxtOcr.recognizeImagesInElement(titleContainer);
              if (imgText && imgText.trim()) {
                question.title = question.title ? question.title + ' ' + imgText.trim() : imgText.trim();
              }
            }
          }
          // 选项中的图片
          if (hasImgInOptions) {
            // 作业页选项图片
            const optBgs = el.querySelectorAll('div.answerBg');
            if (optBgs.length > 0) {
              const imgOpts = [];
              optBgs.forEach(optEl => {
                const letterSpan = optEl.querySelector('span.num_option');
                const letter = letterSpan ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()) : '';
                const optText = optEl.textContent.trim();
                const hasImg = optEl.querySelector('img');
                if (hasImg) {
                  // 图片选项：先取已有文本，后面拼接 OCR 结果
                  imgOpts.push({ idx: imgOpts.length, letter, text: optText, el: optEl, hasImg: true });
                } else {
                  imgOpts.push({ idx: imgOpts.length, letter, text: optText, hasImg: false });
                }
              });
              const newOpts = [];
              for (const opt of imgOpts) {
                if (opt.hasImg) {
                  const imgText = await window.xxtOcr.recognizeImagesInElement(opt.el);
                  const combined = opt.text + (imgText ? ' ' + imgText.trim() : '');
                  newOpts.push((opt.letter ? opt.letter + '. ' : '') + combined);
                } else {
                  newOpts.push((opt.letter ? opt.letter + '. ' : '') + opt.text);
                }
              }
              if (newOpts.length > 0) question.options = newOpts;
            }
            // 课程内测页选项图片
            const liOpts = el.querySelectorAll('ul.Zy_ulTop > li');
            if (liOpts.length > 0 && optBgs.length === 0) {
              const newOpts = [];
              for (const li of liOpts) {
                const letterSpan = li.querySelector('span.num_option');
                const letter = letterSpan ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase() : '';
                const aTag = li.querySelector('a.after');
                const text = aTag ? aTag.textContent.trim() : li.textContent.replace(letter, '').trim();
                if (li.querySelector('img')) {
                  const imgText = await window.xxtOcr.recognizeImagesInElement(li);
                  const combined = text + (imgText ? ' ' + imgText.trim() : '');
                  newOpts.push((letter ? letter + '. ' : '') + combined);
                } else {
                  newOpts.push((letter ? letter + '. ' : '') + text);
                }
              }
              if (newOpts.length > 0) question.options = newOpts;
            }
          }
        } catch (e) { /* 图片 OCR 失败时保留已有文本 */ }
      }
    }

    // --- OCR 截图识别题目（处理字体加密等乱码场景） ---
    if (window.xxtOcr && window.xxtOcr.isReady()) {
      const hasCxSecret = !!document.getElementById('cxSecretStyle');
      if (hasCxSecret) {
        try {
          // 截图识别题干区域
          const titleEl = el.querySelector('div.Zy_TItle div.fontLabel, div.Zy_TItle div.clearfix, h3.mark_name')
            || el.querySelector('div.Zy_TItle');
          if (titleEl) {
            const ocrTitle = await window.xxtOcr.recognizeElement(titleEl);
            if (ocrTitle && ocrTitle.trim().length > 0) {
              const cleaned = ocrTitle
                .replace(/[\[【\(（]?\s*(单选题|多选题|判断题|填空题|简答题)\s*[\]】\)）]?/g, '')
                .replace(/^\s*\d+\s*[.．、]\s*/, '')
                .trim();
              if (cleaned.length > 0) {
                question.title = cleaned;
              }
            }
          }

          // 逐个选项截图识别（比整体截图更准确）
          const liOptions = el.querySelectorAll('ul.Zy_ulTop > li');
          if (liOptions.length > 0) {
            const ocrOpts = [];
            for (const li of liOptions) {
              // 获取选项字母（A/B/C/D）
              const letterSpan = li.querySelector('span.num_option');
              const letter = letterSpan
                ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase()
                : '';
              // 截图识别选项内容
              const optTextEl = li.querySelector('a.after, a[class*="after"]') || li.querySelector('div.after, span.after');
              if (optTextEl) {
                const ocrOpt = await window.xxtOcr.recognizeElement(optTextEl);
                if (ocrOpt && ocrOpt.trim()) {
                  ocrOpts.push((letter ? letter + '. ' : '') + ocrOpt.trim());
                }
              } else if (letter) {
                // 回退：对整个 li 截图
                const ocrLi = await window.xxtOcr.recognizeElement(li);
                if (ocrLi && ocrLi.trim()) {
                  ocrOpts.push(ocrLi.trim());
                }
              }
            }
            if (ocrOpts.length > 0) {
              question.options = ocrOpts;
            }
          }
        } catch (e) { /* OCR 失败时保留 DOM 提取结果 */ }
      }
    }

    return question;
  }

  function guessQuestionType(el, options) {
    if (options.length === 2) {
      const optText = options.join('');
      if (/[对错是否√×✓✗正确错误]/.test(optText)) return '判断题';
    }
    if (options.length > 0) {
      const typeHint = el.textContent;
      if (/多选/.test(typeHint)) return '多选题';
      return '单选题';
    }
    const hasBlank = el.querySelector('input[type="text"], textarea');
    return hasBlank ? '填空题' : '简答题';
  }

  // 检测题目是否已经作答
  function isAlreadyAnswered(el) {
    // 课程内测页: span.num_option 上有 check_answer class
    const checkedClass = el.querySelector('span.num_option.check_answer');
    if (checkedClass) return true;

    // 作业页: div.answerBg 有 cur/checked/selected class
    const checkedOpt = el.querySelector('div.answerBg.cur, div.answerBg.checked, div.answerBg.selected');
    if (checkedOpt) return true;

    // radio/checkbox 有选中
    const checked = el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked');
    if (checked) return true;

    // 隐藏 input answer 有值（课程内测页存答案）
    // 排除 answertype* 开头的（那是题型编号，不是用户答案）
    const answerInput = el.querySelector('input[type="hidden"][name^="answer"]:not([name^="answertype"])');
    if (answerInput && answerInput.value && answerInput.value.trim()) return true;

    // 填空题：编辑器有内容
    const editable = el.querySelector('[contenteditable="true"]');
    if (editable && editable.textContent.trim().length > 0) return true;

    const iframe = el.querySelector('iframe');
    if (iframe && iframe.contentDocument) {
      const body = iframe.contentDocument.body;
      if (body && body.textContent.trim().length > 0) return true;
    }

    const textInput = el.querySelector('input[type="text"]');
    if (textInput && textInput.value.trim().length > 0) return true;

    const textarea = el.querySelector('textarea');
    if (textarea && textarea.value.trim().length > 0) return true;

    return false;
  }

  // ==================== 答案面板 ====================

  let answerPanelVisible = false;

  async function toggleAnswerPanel() {
    answerPanelVisible = !answerPanelVisible;

    let panel = document.getElementById('xxt-answer-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'xxt-answer-panel';
      document.body.appendChild(panel);
    }

    if (answerPanelVisible) {
      await renderAnswerPanel(panel);
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
  }

  async function renderAnswerPanel(panel) {
    const cache = loadCache();
    const questions = await extractQuestions();
    const entries = questions.map(q => {
      const answer = cache[q.title];
      return { index: q.index, type: q.type, title: q.title, options: q.options, answer: answer || null };
    });

    let html = `<div class="xxt-ap-header">
      <span>答案缓存 (${Object.keys(cache).length} 条)</span>
      <button id="xxt-ap-close">&times;</button>
    </div>`;

    if (entries.length === 0) {
      html += '<div class="xxt-ap-empty">暂无题目数据</div>';
    } else {
      html += '<div class="xxt-ap-list">';
      entries.forEach(e => {
        const statusClass = e.answer ? 'has-answer' : 'no-answer';
        html += `<div class="xxt-ap-item ${statusClass}">
          <div class="xxt-ap-num">第${e.index}题 <span class="xxt-ap-type">[${e.type}]</span></div>
          <div class="xxt-ap-title">${escapeHtml(e.title.substring(0, 80))}${e.title.length > 80 ? '...' : ''}</div>
          <div class="xxt-ap-answer">${e.answer ? '<b>' + escapeHtml(e.answer) + '</b>' : '<span class="xxt-ap-pending">未搜索</span>'}</div>
        </div>`;
      });
      html += '</div>';
    }

    html += `<button id="xxt-ap-clear-cache">清空缓存</button>`;
    panel.innerHTML = html;

    panel.querySelector('#xxt-ap-close').addEventListener('click', () => toggleAnswerPanel());
    panel.querySelector('#xxt-ap-clear-cache').addEventListener('click', () => {
      if (confirm('确定清空所有答案缓存？')) {
        localStorage.removeItem(CACHE_KEY);
        renderAnswerPanel(panel);
        log('🗑️ 答案缓存已清空');
      }
    });
  }

  // ==================== 预览题目（调试用） ====================

  async function previewQuestions() {
    // 清除旧的高亮
    document.querySelectorAll('.xxt-debug-tag').forEach(el => el.remove());
    document.querySelectorAll('div[id^="question"]').forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
    document.querySelectorAll('.TiMu').forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });

    const questions = await extractQuestions();

    if (questions.length === 0) {
      log('⚠ 未检测到任何题目');
      return;
    }

    log(`📋 解析到 ${questions.length} 道题目：`);
    log('─'.repeat(40));

    questions.forEach(q => {
      log(`【第 ${q.index} 题】[${q.type}]`);
      log(`  题干: ${q.title}`);
      if (q.options.length > 0) {
        q.options.forEach((opt, i) => {
          log(`  ${String.fromCharCode(65 + i)}: ${opt}`);
        });
      } else {
        log(`  (无选项)`);
      }

      // 在页面 DOM 上标记高亮
      if (q.element) {
        const tag = document.createElement('div');
        tag.className = 'xxt-debug-tag';
        tag.innerHTML = `<b>[${q.type}]</b> 答案区 → ${q.options.length > 0 ? q.options.length + '个选项' : '无选项'}`;
        q.element.style.outline = '2px solid #a8d8ea';
        q.element.style.outlineOffset = '2px';
        q.element.insertBefore(tag, q.element.firstChild);
      }
    });

    log('─'.repeat(40));
    log(`✅ 预览完成，共 ${questions.length} 题`);
    log('题目已在页面中高亮标记，检查完毕后可刷新页面清除');
  }

  // ==================== 搜题主流程 ====================

  async function startSearch() {
    if (isSearching) return;

    const questions = await extractQuestions();
    if (questions.length === 0) {
      log('未检测到题目，请确认当前页面是作业页');
      return;
    }

    isSearching = true;
    totalCount = questions.length;
    currentIndex = 0;
    questionResults.clear();
    updateFloatBtn();

    log(`开始搜题，共 ${totalCount} 道`);

    const settings = await sendToBackground('getSettings');
    const delay = settings.delay || 800;

    try {
      for (let i = 0; i < questions.length; i++) {
        if (!isSearching) break;
        currentIndex = i + 1;
        updateFloatBtn();

        const q = questions[i];

        // 跳过已答过的题目
        if (q.answered) {
          log(`[第${currentIndex}题] 已答过，跳过`);
          continue;
        }

        log(`[第${currentIndex}题] 📖 ${q.title.substring(0, 60)}${q.title.length > 60 ? '...' : ''}`);

        if (q.options.length > 0) {
          log(`[第${currentIndex}题] 📋 ${q.options.map((o, j) => String.fromCharCode(65 + j) + '.' + o.substring(0, 20)).join(' | ')}`);
        }

        // 先查前端缓存
        const cached = getCacheAnswer(q.title);
        if (cached) {
          log(`[第${currentIndex}题] ✅ 答案: ${cached} [缓存]`);
          questionResults.set(currentIndex, { status: 'success', answer: cached });
          renderAnswerTag(q, { answer: cached });
          continue;
        }

        // 调用 AI
        log(`[第${currentIndex}题] 🔍 正在搜索答案...`);
        const result = await sendToBackground('solve', {
          title: q.title,
          options: q.options,
          type: q.type
        });

        if (!isSearching) break;

        if (result.error) {
          log(`[第${currentIndex}题] ❌ 搜索失败: ${result.error}`);
          questionResults.set(currentIndex, { status: 'fail', answer: null });
          continue;
        }

        log(`[第${currentIndex}题] ✅ 答案: ${result.answer}`);
        // 存入前端缓存
        setCacheAnswer(q.title, result.answer);
        questionResults.set(currentIndex, { status: 'success', answer: result.answer });

        // 渲染到页面题目旁边
        renderAnswerTag(q, result);

        // 延迟
        if (i < questions.length - 1 && isSearching) {
          await abortableDelay(delay);
        }
      }

      if (isSearching) {
        log('🎉 全部搜题完成！');
        showSummary();
      }
    } catch (err) {
      log('❌ 运行错误: ' + err.message);
    } finally {
      isSearching = false;
      totalCount = currentIndex;
      updateFloatBtn();
    }
  }

  function stopSearch() {
    isSearching = false;
    if (window.__xxtDelayResolve) {
      window.__xxtDelayResolve();
      window.__xxtDelayResolve = null;
    }
    updateFloatBtn();
    log('⏹ 已停止');
  }

  function abortableDelay(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      window.__xxtDelayResolve = () => { clearTimeout(timer); resolve(); };
    });
  }

  // 在题目 DOM 旁边插入答案标签
  function renderAnswerTag(question, result) {
    if (!question.element) return;

    const oldTag = question.element.querySelector('.xxt-answer-tag');
    if (oldTag) oldTag.remove();

    const tag = document.createElement('div');
    tag.className = 'xxt-answer-tag';
    tag.innerHTML = `<strong>答案: ${escapeHtml(result.answer || '')}</strong>`;
    question.element.appendChild(tag);
  }

  // ==================== 自动填答 ====================

  function autoFillAnswer(question, answer) {
    if (!question.element || !answer) return false;

    const type = question.type.replace(/\s/g, '');
    log(`[填答] 题型="${type}" 答案="${answer}"`);

    if (type === '单选题' || type === '多选题') {
      return fillChoice(question, answer);
    }

    if (type === '判断题') {
      return fillJudgement(question, answer);
    }

    if (type === '填空题') {
      return fillBlank(question, answer);
    }

    // 答案以字母开头且不是判断，按选择题处理
    if (/^[A-Z]+$/i.test(answer.replace(/[,，、\s]/g, '')) && answer.replace(/[,，、\s]/g, '').length <= 4) {
      return fillChoice(question, answer);
    }

    return false;
  }

  // 选择题：点击对应选项
  function fillChoice(question, answer) {
    const letters = answer.replace(/[,，、\s]/g, '').split('').filter(c => /[A-Z]/i.test(c));
    log(`[填答] 需要选择: ${letters.join(',')}`);
    let filled = 0;

    // 方式1: 作业页 div.answerBg
    const optionEls = question.element.querySelectorAll('div.answerBg');
    if (optionEls.length > 0) {
      optionEls.forEach(optEl => {
        const letterSpan = optEl.querySelector('span.num_option');
        const letter = letterSpan ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase() : '';
        if (letters.includes(letter)) {
          optEl.click();
          filled++;
        }
      });
      return filled > 0;
    }

    // 方式2: 课程内测页 ul.Zy_ulTop > li
    const liOptions = question.element.querySelectorAll('ul.Zy_ulTop li');
    if (liOptions.length > 0) {
      liOptions.forEach((li, idx) => {
        // 获取选项字母
        const letterSpan = li.querySelector('span.num_option');
        let letter = '';

        if (letterSpan) {
          letter = (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase();
        }
        if (!letter) {
          const textMatch = li.textContent.trim().match(/^([A-Z])[、.．\s]/);
          if (textMatch) letter = textMatch[1];
        }
        if (!letter && idx < 4) {
          letter = String.fromCharCode(65 + idx);
        }

        log(`[填答] 检测到选项: ${letter}，需匹配: ${letters.includes(letter)}`);

        if (letters.includes(letter)) {
          // 方式A：直接触发底层 input[radio/checkbox]
          const input = li.querySelector('input[type="radio"], input[type="checkbox"]');
          if (input && !input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            filled++;
            return;
          }

          // 方式B：触发 span.num_option 的 click（学习通内测页选中逻辑挂在这里）
          if (letterSpan) {
            letterSpan.click();
            filled++;
            return;
          }

          // 方式C：直接操作 li
          li.click();
          filled++;
        }
      });
      return filled > 0;
    }

    log(`[填答] 未找到可点击的选项元素`);
    return false;
  }

  // 判断题：匹配对/错选项
  function fillJudgement(question, answer) {
    const isRight = /对|正确|✓|√|true|T/i.test(answer);

    // 判断题关键词：对/错、TRUE/FALSE、是/否、正确/错误
    const rightWords = ['对', '正确', '是', 'true', 'TRUE', '√', '✓', 'yes', 'YES', 'right'];
    const wrongWords = ['错', '错误', '否', 'false', 'FALSE', '×', '✗', 'no', 'NO', 'wrong'];
    const targetWords = isRight ? rightWords : wrongWords;

    // 方式1: 作业页 div.answerBg
    const optionEls = question.element.querySelectorAll('div.answerBg');
    if (optionEls.length > 0) {
      for (const optEl of optionEls) {
        const text = optEl.textContent.trim().toUpperCase();
        if (targetWords.some(w => text.includes(w.toUpperCase()))) {
          optEl.click();
          return true;
        }
      }
      // 按字母：A=对 B=错
      const letter = isRight ? 'A' : 'B';
      for (const optEl of optionEls) {
        const l = optEl.querySelector('span.num_option');
        const data = l ? (l.getAttribute('data') || l.textContent.trim()).toUpperCase() : '';
        if (data === letter) {
          optEl.click();
          return true;
        }
      }
    }

    // 方式2: 课程内测页 ul.Zy_ulTop > li
    const liOptions = question.element.querySelectorAll('ul.Zy_ulTop li');
    if (liOptions.length > 0) {
      for (const li of liOptions) {
        const text = li.textContent.trim().toUpperCase();
        log(`[填答] 判断题选项文本: ${text}`);
        if (targetWords.some(w => text.includes(w.toUpperCase()))) {
          // 点击选项
          const input = li.querySelector('input[type="radio"], input[type="checkbox"]');
          if (input && !input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            return true;
          }
          const letterSpan = li.querySelector('span.num_option');
          if (letterSpan) { letterSpan.click(); return true; }
          li.click();
          return true;
        }
      }

      // 回退：第一个 li = 对，第二个 li = 错
      const idx = isRight ? 0 : 1;
      if (liOptions[idx]) {
        const input = liOptions[idx].querySelector('input[type="radio"], input[type="checkbox"]');
        if (input && !input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('click', { bubbles: true }));
          return true;
        }
        liOptions[idx].click();
        return true;
      }
    }

    return false;
  }

  // 填空题：向编辑器插入文本
  function fillBlank(question, answer) {
    const blanks = answer.split('|').map(s => s.trim());
    let filled = 0;

    // 收集所有可能的填空输入区域
    let answerDivs = question.element.querySelectorAll('div.Answer');
    // 课程内测页：填空区域可能是 div.answerTip 或 div.write-tip-wrap
    if (answerDivs.length === 0) {
      answerDivs = question.element.querySelectorAll('div.answerTip, div.write-tip-wrap, div[id^="answer"]');
    }

    answerDivs.forEach((div, i) => {
      const text = blanks[i] || blanks[0] || '';
      if (!text) return;

      // 方式1：UEditor API
      const editorDiv = div.querySelector('.edui-editor');
      if (editorDiv) {
        const editorId = editorDiv.id;
        try {
          if (window.UE && typeof UE.getEditor === 'function') {
            const editor = UE.getEditor(editorId);
            if (editor && editor.setContent) {
              editor.setContent(text);
              filled++;
              return;
            }
          }
        } catch (e) { /* 降级 */ }

        // contenteditable
        const editable = div.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.textContent = text;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
          return;
        }

        // iframe
        const iframe = div.querySelector('iframe');
        if (iframe && iframe.contentDocument) {
          iframe.contentDocument.body.textContent = text;
          iframe.contentDocument.body.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
          return;
        }
      }

      // 方式2：课程内测页 textarea（在 div 内或紧邻）
      const textarea = div.querySelector('textarea');
      if (textarea) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, text);
        else textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
        return;
      }

      // 方式3：普通 input
      const input = div.querySelector('input[type="text"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, text);
        else input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
        return;
      }
    });

    // 回退：在整个题目元素中找 input/textarea
    if (filled === 0) {
      const inputs = question.element.querySelectorAll('input[type="text"], textarea');
      inputs.forEach((input, i) => {
        const text = blanks[i] || blanks[0] || '';
        if (!text) return;
        const setter = Object.getOwnPropertyDescriptor(
          (input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement).prototype, 'value'
        )?.set;
        if (setter) setter.call(input, text);
        else input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      });
    }

    log(`[填答] 填空题: ${filled} 个空已填入`);
    return filled > 0;
  }

  // 一键填答所有已有答案的题目
  async function autoFillAll() {
    const questions = await extractQuestions();
    const cache = loadCache();
    let filled = 0, failed = 0;

    log(`📝 开始自动填答，共 ${questions.length} 题`);

    for (const q of questions) {
      // 先精确匹配，再模糊匹配（OCR 两次结果可能略有差异）
      let answer = cache[q.title];
      if (!answer) {
        const qTitleClean = q.title.replace(/\s/g, '');
        for (const [k, v] of Object.entries(cache)) {
          if (k.replace(/\s/g, '') === qTitleClean) {
            answer = v;
            break;
          }
        }
      }
      if (!answer) {
        log(`[第${q.index}题] ⏭ 无答案，跳过`);
        continue;
      }

      const ok = autoFillAnswer(q, answer);
      if (ok) {
        log(`[第${q.index}题] ✅ 已填答: ${answer}`);
        filled++;
      } else {
        log(`[第${q.index}题] ❌ 填答失败`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    log(`📊 填答完成: 成功 ${filled} | 失败 ${failed}`);
  }

  function showSummary() {
    let success = 0, fail = 0;
    const failList = [];

    questionResults.forEach((r, idx) => {
      if (r.status === 'success') success++;
      else { fail++; failList.push(idx); }
    });

    log(`📊 汇总: 成功 ${success} | 失败 ${fail}`);
    if (failList.length > 0) {
      log(`⚠ 失败: 第 ${failList.join(', ')} 题`);
    }
  }

  // ==================== OCR 手动识别 ====================

  async function ocrCurrentQuestions() {
    if (!window.xxtOcr) {
      log('❌ OCR 模块未加载，请刷新页面后重试');
      return;
    }

    if (!window.xxtOcr.isReady()) {
      log('❌ OCR 引擎未就绪（tesseract.js 或 html2canvas 未加载），请刷新页面后重试');
      return;
    }

    // 不走 extractQuestions（里面也会 OCR），直接拿 DOM 元素
    let qList = document.querySelectorAll('div[id^="question"].questionLi');
    if (qList.length === 0) qList = document.querySelectorAll('div[id^="question"]');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.newTiMu');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.divQuestion');
    if (qList.length === 0) qList = document.querySelectorAll('.divQuestion');

    if (qList.length === 0) {
      log('⚠ 未检测到题目');
      return;
    }

    log(`📷 发现 ${qList.length} 道题，开始 OCR 截图识别...`);
    let recognized = 0;

    for (let idx = 0; idx < qList.length; idx++) {
      const el = qList[idx];
      log(`[第${idx + 1}题] 📷 正在截图识别...`);

      let ocrTitle = null;
      const ocrOpts = [];

      // 截图识别题干区域
      const titleEl = el.querySelector('div.Zy_TItle div.fontLabel, div.Zy_TItle div.clearfix, h3.mark_name')
        || el.querySelector('div.Zy_TItle');
      if (titleEl) {
        ocrTitle = await window.xxtOcr.recognizeElement(titleEl);
        if (ocrTitle) {
          ocrTitle = ocrTitle
            .replace(/[\[【\(（]?\s*(单选题|多选题|判断题|填空题|简答题)\s*[\]】\)）]?/g, '')
            .replace(/^\s*\d+\s*[.．、]\s*/, '')
            .trim();
        }
      }

      // 逐个选项截图识别
      const liOptions = el.querySelectorAll('ul.Zy_ulTop > li');
      if (liOptions.length > 0) {
        for (const li of liOptions) {
          const letterSpan = li.querySelector('span.num_option');
          const letter = letterSpan
            ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase()
            : '';
          const optTextEl = li.querySelector('a.after, a[class*="after"]') || li.querySelector('div.after, span.after');
          if (optTextEl) {
            const ocrOpt = await window.xxtOcr.recognizeElement(optTextEl);
            if (ocrOpt && ocrOpt.trim()) {
              ocrOpts.push((letter ? letter + '. ' : '') + ocrOpt.trim());
            }
          } else if (letter) {
            const ocrLi = await window.xxtOcr.recognizeElement(li);
            if (ocrLi && ocrLi.trim()) {
              ocrOpts.push(ocrLi.trim());
            }
          }
        }
      }

      // 如果题干和选项都没拿到，尝试对整题截图
      if (!ocrTitle && ocrOpts.length === 0) {
        const fullText = await window.xxtOcr.recognizeElement(el);
        if (fullText) {
          ocrTitle = fullText;
        }
      }

      if (ocrTitle || ocrOpts.length > 0) {
        recognized++;
        const display = [ocrTitle, ...ocrOpts].filter(Boolean).join(' | ');
        log(`[第${idx + 1}题] ✅ ${display.substring(0, 100)}${display.length > 100 ? '...' : ''}`);

        // 显示到页面上
        const oldTag = el.querySelector('.xxt-ocr-tag');
        if (oldTag) oldTag.remove();
        const tag = document.createElement('div');
        tag.className = 'xxt-ocr-tag';
        let tagHtml = '';
        if (ocrTitle) tagHtml += `<strong>题干:</strong> ${escapeHtml(ocrTitle)}`;
        if (ocrOpts.length > 0) {
          tagHtml += (ocrTitle ? '<br>' : '') + `<strong>选项:</strong> ` + ocrOpts.map(o => escapeHtml(o)).join(' | ');
        }
        tag.innerHTML = tagHtml;
        el.appendChild(tag);
      } else {
        log(`[第${idx + 1}题] ❌ OCR 未识别到文字`);
      }
    }

    log(`📊 OCR 完成: 成功识别 ${recognized}/${qList.length} 题`);
  }

  // ==================== 一键流程：OCR → 搜题 → 填答 ====================

  async function oneClickFlow() {
    if (isSearching) return;
    if (!window.xxtOcr || !window.xxtOcr.isReady()) {
      log('❌ OCR 引擎未就绪，请刷新页面后重试');
      return;
    }

    const settings = await sendToBackground('getSettings');
    if (!settings.apiKey) {
      log('❌ 未配置 API Key，请先在设置中填入');
      return;
    }

    // 获取题目 DOM 元素
    let qList = document.querySelectorAll('div[id^="question"].questionLi');
    if (qList.length === 0) qList = document.querySelectorAll('div[id^="question"]');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.newTiMu');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.divQuestion');
    if (qList.length === 0) qList = document.querySelectorAll('.divQuestion');

    if (qList.length === 0) {
      log('⚠ 未检测到题目');
      return;
    }

    isSearching = true;
    totalCount = qList.length;
    currentIndex = 0;
    questionResults.clear();
    updateFloatBtn();

    log(`🚀 一键流程启动，共 ${totalCount} 题`);
    log('─── 第1步: OCR 识别 ───');

    const delay = settings.delay || 800;
    let ocrSuccess = 0;

    try {
      // 阶段1: OCR 识别所有题目
      const ocrResults = [];
      for (let idx = 0; idx < qList.length; idx++) {
        if (!isSearching) break;
        currentIndex = idx + 1;
        updateFloatBtn();

        const el = qList[idx];
        log(`[第${currentIndex}题] 📷 OCR 识别中...`);

        let ocrTitle = null;
        const ocrOpts = [];
        let questionType = '';

        // 截图识别题干
        const titleEl = el.querySelector('div.Zy_TItle div.fontLabel, div.Zy_TItle div.clearfix, h3.mark_name')
          || el.querySelector('div.Zy_TItle');
        if (titleEl) {
          ocrTitle = await window.xxtOcr.recognizeElement(titleEl);
          if (ocrTitle) {
            // 提取题型
            const typeMatch = ocrTitle.match(/[\[【\(（]?\s*(单选题|多选题|判断题|填空题|简答题)\s*[\]】\)）]?/);
            if (typeMatch) questionType = typeMatch[1];
            ocrTitle = ocrTitle
              .replace(/[\[【\(（]?\s*(单选题|多选题|判断题|填空题|简答题)\s*[\]】\)）]?/g, '')
              .replace(/^\s*\d+\s*[.．、]\s*/, '')
              .trim();
          }
        }

        // 逐个选项截图识别
        const liOptions = el.querySelectorAll('ul.Zy_ulTop > li');
        if (liOptions.length > 0) {
          for (const li of liOptions) {
            const letterSpan = li.querySelector('span.num_option');
            const letter = letterSpan
              ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase()
              : '';
            const optTextEl = li.querySelector('a.after, a[class*="after"]') || li.querySelector('div.after, span.after');
            if (optTextEl) {
              const ocrOpt = await window.xxtOcr.recognizeElement(optTextEl);
              if (ocrOpt && ocrOpt.trim()) {
                ocrOpts.push((letter ? letter + '. ' : '') + ocrOpt.trim());
              }
            } else if (letter) {
              const ocrLi = await window.xxtOcr.recognizeElement(li);
              if (ocrLi && ocrLi.trim()) {
                ocrOpts.push(ocrLi.trim());
              }
            }
          }
        }

        if (!questionType) {
          questionType = guessQuestionType(el, ocrOpts);
        }

        if (ocrTitle || ocrOpts.length > 0) {
          ocrSuccess++;
          log(`[第${currentIndex}题] ✅ ${ocrTitle ? ocrTitle.substring(0, 50) : '(无题干)'}`);
        }

        // 显示 OCR 结果到页面
        const oldTag = el.querySelector('.xxt-ocr-tag');
        if (oldTag) oldTag.remove();
        const tag = document.createElement('div');
        tag.className = 'xxt-ocr-tag';
        let tagHtml = '';
        if (ocrTitle) tagHtml += `<strong>题干:</strong> ${escapeHtml(ocrTitle)}`;
        if (ocrOpts.length > 0) {
          tagHtml += (ocrTitle ? '<br>' : '') + `<strong>选项:</strong> ` + ocrOpts.map(o => escapeHtml(o)).join(' | ');
        }
        tag.innerHTML = tagHtml;
        el.appendChild(tag);

        ocrResults.push({ el, ocrTitle, ocrOpts, questionType, answered: isAlreadyAnswered(el) });
      }

      log(`📊 OCR 完成: ${ocrSuccess}/${totalCount} 题`);

      // 阶段2: AI 搜题
      log('─── 第2步: AI 搜题 ───');
      let searchSuccess = 0;

      for (let i = 0; i < ocrResults.length; i++) {
        if (!isSearching) break;
        const item = ocrResults[i];

        if (item.answered) {
          log(`[第${i + 1}题] 已答过，跳过`);
          continue;
        }

        if (!item.ocrTitle) {
          log(`[第${i + 1}题] ⏭ 无题干，跳过`);
          continue;
        }

        // 查缓存
        const cached = getCacheAnswer(item.ocrTitle);
        if (cached) {
          log(`[第${i + 1}题] ✅ 答案: ${cached} [缓存]`);
          questionResults.set(i + 1, { status: 'success', answer: cached });
          renderAnswerTag({ element: item.el }, { answer: cached });
          searchSuccess++;
          continue;
        }

        log(`[第${i + 1}题] 🔍 搜索答案...`);
        const result = await sendToBackground('solve', {
          title: item.ocrTitle,
          options: item.ocrOpts,
          type: item.questionType
        });

        if (!isSearching) break;

        if (result.error) {
          log(`[第${i + 1}题] ❌ 搜索失败: ${result.error}`);
          questionResults.set(i + 1, { status: 'fail', answer: null });
          continue;
        }

        log(`[第${i + 1}题] ✅ 答案: ${result.answer}`);
        setCacheAnswer(item.ocrTitle, result.answer);
        questionResults.set(i + 1, { status: 'success', answer: result.answer });
        renderAnswerTag({ element: item.el }, result);
        searchSuccess++;

        // 存到 ocrResults 中供填答使用
        item.answer = result.answer;

        if (i < ocrResults.length - 1 && isSearching) {
          await abortableDelay(delay);
        }
      }

      log(`📊 搜题完成: 成功 ${searchSuccess} 题`);

      // 阶段3: 自动填答
      log('─── 第3步: 自动填答 ───');
      let filled = 0, failed = 0;

      for (let i = 0; i < ocrResults.length; i++) {
        const item = ocrResults[i];
        if (!item.answer || item.answered) continue;

        const q = {
          index: i + 1,
          type: item.questionType,
          element: item.el
        };
        const ok = autoFillAnswer(q, item.answer);
        if (ok) {
          log(`[第${i + 1}题] ✅ 已填答: ${item.answer}`);
          filled++;
        } else {
          log(`[第${i + 1}题] ❌ 填答失败`);
          failed++;
        }

        await new Promise(r => setTimeout(r, 300));
      }

      log(`📊 填答完成: 成功 ${filled} | 失败 ${failed}`);
      if (isSearching) {
        log('🎉 一键流程全部完成！');
        showSummary();
      }
    } catch (err) {
      log('❌ 运行错误: ' + err.message);
    } finally {
      isSearching = false;
      totalCount = currentIndex;
      updateFloatBtn();
    }
  }

  // ==================== 浮动 UI ====================

  function createFloatUI() {
    const container = document.createElement('div');
    container.id = 'xxt-float';
    container.innerHTML = `
      <div id="xxt-float-header">
        <span id="xxt-float-title">XuexiTong Assistant</span>
        <button id="xxt-float-toggle">_</button>
      </div>
      <div id="xxt-float-body">
        <div id="xxt-float-status">就绪</div>
        <div id="xxt-float-actions">
          <button id="xxt-float-start">搜题</button>
          <button id="xxt-float-fill">填答</button>
          <button id="xxt-float-oneclick">一键</button>
          <button id="xxt-float-preview">预览</button>
          <button id="xxt-float-ocr">OCR</button>
          <button id="xxt-float-answers">答案</button>
        </div>
        <div id="xxt-float-log"></div>
      </div>
    `;
    document.body.appendChild(container);

    document.getElementById('xxt-float-toggle').addEventListener('click', toggleMinimize);
    document.getElementById('xxt-float-start').addEventListener('click', () => {
      if (isSearching) {
        stopSearch();
      } else {
        startSearch();
      }
    });
    document.getElementById('xxt-float-preview').addEventListener('click', previewQuestions);
    document.getElementById('xxt-float-ocr').addEventListener('click', ocrCurrentQuestions);
    document.getElementById('xxt-float-oneclick').addEventListener('click', () => {
      if (isSearching) {
        stopSearch();
      } else {
        oneClickFlow();
      }
    });
    document.getElementById('xxt-float-answers').addEventListener('click', toggleAnswerPanel);
    document.getElementById('xxt-float-fill').addEventListener('click', autoFillAll);

    makeDraggable(container, document.getElementById('xxt-float-header'));
  }

  function toggleMinimize() {
    const body = document.getElementById('xxt-float-body');
    const toggle = document.getElementById('xxt-float-toggle');
    const isMinimized = body.style.display === 'none';
    body.style.display = isMinimized ? 'block' : 'none';
    toggle.textContent = isMinimized ? '_' : '□';
  }

  function updateFloatBtn() {
    const btn = document.getElementById('xxt-float-start');
    const status = document.getElementById('xxt-float-status');
    if (!btn) return;

    if (isSearching) {
      btn.textContent = '停止';
      btn.classList.add('running');
      status.textContent = `正在搜题... ${currentIndex}/${totalCount}`;
    } else {
      btn.textContent = '开始搜题';
      btn.classList.remove('running');
      if (currentIndex > 0) {
        status.textContent = `完成 ${totalCount}/${totalCount}`;
      } else {
        status.textContent = '就绪';
      }
    }
  }

  function log(msg) {
    const logEl = document.getElementById('xxt-float-log');
    if (!logEl) return;

    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;

    while (logEl.children.length > 100) {
      logEl.removeChild(logEl.firstChild);
    }

    console.log('[XXT Assistant]', msg);
  }

  function makeDraggable(el, handle) {
    let offsetX = 0, offsetY = 0, isDragging = false;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      offsetX = e.clientX - el.offsetLeft;
      offsetY = e.clientY - el.offsetTop;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      el.style.left = (e.clientX - offsetX) + 'px';
      el.style.top = (e.clientY - offsetY) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ==================== 初始化 ====================

  // 快速检查页面是否包含题目元素
  function checkPageHasQuestions() {
    if (document.querySelector('div[id^="question"]')) return true;
    if (document.querySelector('.TiMu.newTiMu')) return true;
    if (document.querySelector('.TiMu.divQuestion')) return true;
    if (document.querySelector('div.answerBg')) return true;
    if (document.querySelector('ul.Zy_ulTop')) return true;
    if (document.querySelector('span.newZy_TItle')) return true;
    if (document.querySelector('h3.mark_name')) return true;
    return false;
  }

  function init() {
    if (document.getElementById('xxt-float')) return;

    if (!document.body || document.body.children.length === 0) return false;

    // 没有题目元素的页面不注入浮窗
    if (!checkPageHasQuestions()) return false;

    createFloatUI();
    log('插件已加载，点击「搜题」');

    return true;
  }

  // 轮询等待页面渲染完成
  function waitForPageReady() {
    const maxWait = 15000; // 最多等 15 秒
    const interval = 500;
    let elapsed = 0;

    function tryInit() {
      if (init()) return; // 初始化成功，停止轮询
      elapsed += interval;
      if (elapsed < maxWait) {
        setTimeout(tryInit, interval);
      }
    }

    // 立即尝试 + 轮询
    tryInit();

    // MutationObserver 监听 DOM 变化，一旦有内容就初始化
    if (document.documentElement) {
      const observer = new MutationObserver(() => {
        if (document.body && document.body.children.length > 0 && !document.getElementById('xxt-float')) {
          init();
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // 15 秒后自动停止监听
      setTimeout(() => observer.disconnect(), maxWait);
    }
  }

  waitForPageReady();
})();
