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

  // ==================== font-cxsecret 字体解密 ====================

  const CXSECRET_CACHE_KEY = 'xxt_cxsecret_map';
  // 约 2500 个最常用汉字，用于 canvas 渲染对比建立映射
  const COMMON_CHARS =
    '的一是不了人我在有他这中大来上个国到说们为子和你地出会也时要就可以对生能而那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克干排满西增则却石流统县难布声思华世收铁军确华车调代改转族城历千形确林极古组近花师央取受奇举命术款北且持住交推求更细断朋林怎格青空急织布局基影压质足注资汉答读际织规未调响收素约证议六止件流半食兴治张备济客留办积值府际置际步消越座整至配号群际展权值离抓支配改具收论落约始精红装适常调权朝历值门统适请落据须响育便平往今六采列备化完线万答办称收原龙思该反众电海则七术角需支具走号何类再严条展西支取复建眼约号具干形众清布格资铁指装铁始争流压八满备证周及况低必效精具周值验周量展采统切争完细术江青切百院近影指列区取老复按半青包各思养程列细角采青半华及南';

  // 检测页面是否使用了 cxsecret 字体
  function hasCxSecretFont() {
    return !!document.getElementById('cxSecretStyle');
  }

  // 用 canvas 渲染单个字符，返回像素指纹（简单 hash）
  function renderCharFingerprint(char, fontFamily) {
    const canvas = document.createElement('canvas');
    canvas.width = 28;
    canvas.height = 28;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 28, 28);
    ctx.font = '18px ' + fontFamily + ', sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(char, 14, 14);
    const data = ctx.getImageData(0, 0, 28, 28).data;
    // 对非透明像素做简单累加 hash，避免逐像素比较
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        hash = ((hash << 5) - hash + data[i] + data[i + 1] + data[i + 2]) | 0;
      }
    }
    return hash;
  }

  // 构建 cxsecret 字符 → 明文字符的映射表
  async function buildCxSecretMap() {
    // 先尝试从缓存加载
    try {
      const cached = localStorage.getItem(CXSECRET_CACHE_KEY);
      if (cached) {
        const map = JSON.parse(cached);
        if (map && Object.keys(map).length > 0) {
          log(`[字体解密] 从缓存加载映射表 (${Object.keys(map).length} 条)`);
          return map;
        }
      }
    } catch { /* 缓存无效，重新构建 */ }

    // 等待字体加载完成
    await document.fonts.ready;

    // 收集页面中实际出现的需要解密的字符（排除常用汉字和 ASCII）
    const allText = document.body.textContent;
    const charSet = new Set();
    for (const ch of allText) {
      if (COMMON_CHARS.includes(ch) || /[\x00-\x7F]/.test(ch)) continue;
      // 只保留可能是 cxsecret 替换的中文字符（CJK 统一汉字范围）
      if (/[\u4e00-\u9fff]/.test(ch)) {
        charSet.add(ch);
      }
    }

    if (charSet.size === 0) {
      log('[字体解密] 页面无加密字符');
      return {};
    }

    log(`[字体解密] 发现 ${charSet.size} 个待解密字符，开始构建映射...`);

    // 用标准字体渲染常用汉字，建立参考指纹
    const refFingerprints = new Map();
    for (const ch of COMMON_CHARS) {
      if (!refFingerprints.has(ch)) {
        refFingerprints.set(ch, renderCharFingerprint(ch, 'sans-serif'));
      }
    }

    // 用 cxsecret 字体渲染加密字符，匹配参考指纹
    const decryptMap = {};
    for (const ch of charSet) {
      const secretHash = renderCharFingerprint(ch, 'font-cxsecret');
      for (const [refChar, refHash] of refFingerprints) {
        if (secretHash === refHash) {
          decryptMap[ch] = refChar;
          break;
        }
      }
    }

    const mapped = Object.keys(decryptMap).length;
    log(`[字体解密] 映射构建完成: ${mapped}/${charSet.size} 个字符成功匹配`);

    // 缓存映射表
    if (mapped > 0) {
      try {
        localStorage.setItem(CXSECRET_CACHE_KEY, JSON.stringify(decryptMap));
      } catch { /* 存储满等异常忽略 */ }
    }

    return decryptMap;
  }

  // 预加载：页面初始化时检测到 cxsecret 字体就提前构建映射
  let cxSecretMapPromise = null;
  let cxSecretDetected = false;

  function prefetchCxSecretMap() {
    if (cxSecretMapPromise || cxSecretDetected) return;
    if (!hasCxSecretFont()) return;
    cxSecretDetected = true;
    log('[字体解密] 检测到 cxsecret 字体，预加载映射表...');
    cxSecretMapPromise = buildCxSecretMap();
  }

  // 对文本应用解密映射
  async function decryptCxSecretText(text) {
    if (!text) return text;

    // 如果页面没有 cxsecret 字体，直接返回原文
    if (!cxSecretDetected && !hasCxSecretFont()) return text;

    // 获取映射表（使用预加载结果或重新构建）
    if (!cxSecretMapPromise) {
      cxSecretDetected = true;
      cxSecretMapPromise = buildCxSecretMap();
    }

    let decryptMap;
    try {
      decryptMap = await cxSecretMapPromise;
    } catch {
      return text;
    }

    if (!decryptMap || Object.keys(decryptMap).length === 0) return text;

    // 逐字符替换
    let result = '';
    for (const ch of text) {
      result += decryptMap[ch] || ch;
    }
    return result;
  }

  // ==================== 题目提取 ====================

  function extractQuestions() {
    const questions = [];
    let qList = document.querySelectorAll('div[id^="question"].questionLi');
    if (qList.length === 0) qList = document.querySelectorAll('div[id^="question"]');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.newTiMu');
    if (qList.length === 0) qList = document.querySelectorAll('.TiMu.divQuestion');
    if (qList.length === 0) qList = document.querySelectorAll('.divQuestion');

    qList.forEach((item, idx) => {
      const q = extractOneQuestion(item, idx);
      if (q.title.trim()) questions.push(q);
    });

    return questions;
  }

  function extractOneQuestion(el, index) {
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
    const answerInput = el.querySelector('input[name^="answer"][type="hidden"]');
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

  function toggleAnswerPanel() {
    answerPanelVisible = !answerPanelVisible;

    let panel = document.getElementById('xxt-answer-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'xxt-answer-panel';
      document.body.appendChild(panel);
    }

    if (answerPanelVisible) {
      renderAnswerPanel(panel);
      panel.classList.add('open');
    } else {
      panel.classList.remove('open');
    }
  }

  function renderAnswerPanel(panel) {
    const cache = loadCache();
    const questions = extractQuestions();
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

  function previewQuestions() {
    // 清除旧的高亮
    document.querySelectorAll('.xxt-debug-tag').forEach(el => el.remove());
    document.querySelectorAll('div[id^="question"]').forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });

    const questions = extractQuestions();

    if (questions.length === 0) {
      log('⚠ 未检测到任何题目');
      log('尝试的选择器: div[id^="question"].questionLi');
      return;
    }

    log(`📋 解析到 ${questions.length} 道题目：`);
    log('─'.repeat(40));

    questions.forEach(q => {
      // 日志输出结构化数据
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

    const questions = extractQuestions();
    if (questions.length === 0) {
      log('未检测到题目，请确认当前页面是作业页');
      return;
    }

    // 预加载字体解密映射（如果页面使用了 cxsecret 字体）
    prefetchCxSecretMap();

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

        // 对题干和选项做 cxsecret 字体解密
        q.title = await decryptCxSecretText(q.title);
        q.options = await Promise.all(q.options.map(opt => decryptCxSecretText(opt)));

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

    const type = question.type;

    if (type === '单选题' || type === '多选题') {
      return fillChoice(question, answer);
    }

    if (type === '判断题') {
      return fillJudgement(question, answer);
    }

    if (type === '填空题') {
      return fillBlank(question, answer);
    }

    return false;
  }

  // 选择题：点击对应选项
  function fillChoice(question, answer) {
    const letters = answer.replace(/[,，、\s]/g, '').split('').filter(c => /[A-Z]/i.test(c));
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
      liOptions.forEach(li => {
        const letterSpan = li.querySelector('span.num_option');
        const letter = letterSpan ? (letterSpan.getAttribute('data') || letterSpan.textContent.trim()).toUpperCase() : '';
        if (letters.includes(letter)) {
          li.click();
          filled++;
        }
      });
      return filled > 0;
    }

    return false;
  }

  // 判断题：匹配对/错选项
  function fillJudgement(question, answer) {
    const optionEls = question.element.querySelectorAll('div.answerBg');
    const target = /对|正确|✓|√|true|T/i.test(answer) ? '对' : '错';

    for (const optEl of optionEls) {
      const text = optEl.textContent.trim();
      if (text.includes(target) || (target === '对' && /正确|✓|√/.test(text))) {
        optEl.click();
        return true;
      }
    }
    // 备用：直接按字母选（A=对 B=错 的惯例）
    const letterSpan = question.element.querySelector('div.answerBg span.num_option');
    if (letterSpan) {
      const letter = target === '对' ? 'A' : 'B';
      const optEls = question.element.querySelectorAll('div.answerBg');
      for (const optEl of optEls) {
        const l = optEl.querySelector('span.num_option');
        const data = l ? (l.getAttribute('data') || l.textContent.trim()).toUpperCase() : '';
        if (data === letter) {
          optEl.click();
          return true;
        }
      }
    }
    return false;
  }

  // 填空题：向 UEditor 插入文本
  function fillBlank(question, answer) {
    // 多个空用 | 分隔
    const blanks = answer.split('|').map(s => s.trim());
    // 每个 .Answer 对应一个空
    const answerDivs = question.element.querySelectorAll('div.Answer');

    let filled = 0;
    answerDivs.forEach((div, i) => {
      const text = blanks[i] || blanks[0] || '';
      if (!text) return;

      // 方式1：尝试 UEditor API（学习通用 UEditor 富文本编辑器）
      const editorDiv = div.querySelector('.edui-editor');
      if (editorDiv) {
        const editorId = editorDiv.id;
        // UE.getEditor(id).setContent(text)
        try {
          if (window.UE && typeof UE.getEditor === 'function') {
            const editor = UE.getEditor(editorId);
            if (editor && editor.setContent) {
              editor.setContent(text);
              filled++;
              return;
            }
          }
        } catch (e) { /* 降级处理 */ }

        // 方式2：直接操作 contenteditable
        const editable = div.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.textContent = text;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
          return;
        }

        // 方式3：操作 iframe
        const iframe = div.querySelector('iframe');
        if (iframe && iframe.contentDocument) {
          const body = iframe.contentDocument.body;
          body.textContent = text;
          body.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
          return;
        }
      }

      // 备用：普通 input/textarea
      const input = div.querySelector('input[type="text"], textarea');
      if (input) {
        // React/Vue 需要触发原生 setter
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set || Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, text);
        } else {
          input.value = text;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        filled++;
      }
    });

    return filled > 0;
  }

  // 一键填答所有已有答案的题目
  async function autoFillAll() {
    const questions = extractQuestions();
    const cache = loadCache();
    let filled = 0, failed = 0;

    log(`📝 开始自动填答，共 ${questions.length} 题`);

    for (const q of questions) {
      const answer = cache[q.title];
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
          <button id="xxt-float-preview">预览</button>
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

    // 检测 cxsecret 字体并预加载解密映射
    prefetchCxSecretMap();

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
