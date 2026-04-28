// ocr.js - OCR 识别模块（tesseract.js + html2canvas 通过 manifest 注入）

(() => {
  'use strict';

  if (window.__xxtOcrLoaded) return;
  window.__xxtOcrLoaded = true;

  let ocrWorker = null;

  function isReady() {
    return !!window.Tesseract && !!window.html2canvas;
  }

  async function getWorker() {
    if (ocrWorker) return ocrWorker;
    if (!window.Tesseract) return null;

    try {
      ocrWorker = await window.Tesseract.createWorker('chi_sim');
      return ocrWorker;
    } catch (err) {
      console.error('[XXT OCR] 创建 worker 失败:', err);
      return null;
    }
  }

  // OCR 文本后处理：去除加密字体导致的字间多余空格
  function cleanOcrText(text) {
    if (!text) return text;
    // 去除中文字符之间的空格（如 "深 度 学 习" → "深度学习"）
    let cleaned = text.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
    // 多次替换直到没有变化（处理连续空格的情况）
    let prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
    } while (cleaned !== prev);
    // 去除中文和标点之间的空格
    cleaned = cleaned.replace(/([\u4e00-\u9fff])\s+([，。、；：！？（）【】""''《》])/g, '$1$2');
    cleaned = cleaned.replace(/([，。、；：！？（）【】""''《》])\s+([\u4e00-\u9fff])/g, '$1$2');
    // 合并多余空格
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    return cleaned.trim();
  }

  async function recognize(imageSource) {
    const worker = await getWorker();
    if (!worker) return null;

    try {
      const result = await worker.recognize(imageSource);
      return cleanOcrText(result.data.text.trim());
    } catch (err) {
      console.error('[XXT OCR] 识别失败:', err);
      return null;
    }
  }

  async function recognizeElement(el) {
    if (!window.html2canvas) return null;

    try {
      const canvas = await window.html2canvas(el, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
        onclone: (doc, clonedEl) => {
          // 移除克隆文档中加载失败的样式表
          doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
            const href = link.href || '';
            if (href.includes('.cssx?') || href.includes('work-css-tpl')) {
              link.remove();
            }
          });
          // 确保克隆元素的字体能正确渲染
          clonedEl.style.fontFamily = 'sans-serif';
        }
      });

      return await recognize(canvas);
    } catch (err) {
      console.error('[XXT OCR] 截图识别失败:', err);
      return null;
    }
  }

  async function recognizeImagesInElement(el, onProgress) {
    const images = el.querySelectorAll('img');
    if (images.length === 0) return null;

    const texts = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (onProgress) onProgress(i + 1, images.length);

      if (!img.complete) {
        await new Promise(r => {
          img.onload = r;
          img.onerror = r;
          setTimeout(r, 1000);
        });
      }

      if (img.naturalWidth < 20 || img.naturalHeight < 20) continue;

      const text = await recognize(img.src);
      if (text) texts.push(text);
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }

  window.xxtOcr = {
    isReady,
    recognize,
    recognizeElement,
    recognizeImagesInElement,
    cleanOcrText,
    terminate: async () => {
      if (ocrWorker) {
        await ocrWorker.terminate();
        ocrWorker = null;
      }
    }
  };
})();
