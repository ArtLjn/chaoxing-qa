# XXT Assistant - 学习通搜题助手

基于 Chrome Extension Manifest V3 的学习通自动搜题插件，调用大语言模型（阿里百炼/OpenAI 兼容接口）搜索答案并自动填答。支持 OCR 识别字体加密的课程内测页题目。

## 功能特性

- 自动识别学习通作业页面的全部题目（单选/多选/判断/填空）
- **OCR 识别**：通过 tesseract.js + html2canvas 截图识别字体加密的课程内测页题目
- 一键流程：OCR 识别 → AI 搜题 → 自动填答
- 调用 AI 模型搜索答案，支持自定义模型和 API 地址
- 答案本地缓存（localStorage），重复题目直接命中
- 自动填答：选择题点击选项、判断题匹配对错、填空题插入文本（支持 UEditor）
- 可拖拽浮动控制面板 + 实时日志
- 答案缓存面板，随时查看历史答案

## 支持的题型

| 题型 | DOM 提取 | OCR 识别 | 自动填答 |
|------|:--------:|:--------:|:--------:|
| 单选题 | ✅ | ✅ | ✅ |
| 多选题 | ✅ | ✅ | ✅ |
| 判断题 | ✅ | ✅ | ✅ |
| 填空题 | ✅ | ✅ | ✅ |

## 安装

1. 克隆仓库

```bash
git clone https://github.com/ArtLjn/xuexitong-auto-answer.git
```

2. 安装依赖（打包 OCR 库到扩展中）

```bash
npm install
cp node_modules/tesseract.js/dist/tesseract.min.js lib/
cp node_modules/tesseract.js/dist/worker.min.js lib/
cp node_modules/html2canvas/dist/html2canvas.min.js lib/
```

3. 打开 Chrome，地址栏输入 `chrome://extensions`
4. 开启右上角 **开发者模式**
5. 点击 **加载已解压的扩展程序**，选择项目文件夹
6. 插件图标出现在浏览器工具栏

## 使用

### 1. 配置

点击插件图标，在弹出页面中填写：

| 配置项 | 说明 |
|--------|------|
| API Key | 阿里百炼 / OpenAI 兼容 API 的 Key |
| 模型 | 从下拉框快捷选择或手动输入任意模型名 |
| Base URL | API 地址，默认阿里百炼 |
| 每题延迟 | 搜题间隔时间，避免触发限流 |

> 阿里百炼 API Key 获取：[阿里云控制台](https://dashscope.console.aliyun.com/) → DashScope → API-KEY 管理

### 2. 一键流程

打开课程内测页或作业页面，点击 **「一键」** 按钮，自动完成：

1. **OCR 识别** — 截图识别每题题干和选项（处理字体加密乱码）
2. **AI 搜题** — 调用大语言模型搜索答案
3. **自动填答** — 将答案填入页面

### 3. 分步操作

也可以单独使用各功能：

- **搜题** — 提取题目并逐题搜索答案（普通作业页用 DOM 提取，加密页面自动走 OCR）
- **填答** — 将缓存中的答案自动填入页面
- **OCR** — 手动对所有题目进行截图识别，结果显示在页面
- **预览** — 查看解析出的题目和选项
- **答案** — 打开侧边面板查看所有已缓存答案

### 填答说明

- 单选题/多选题 → 自动点击对应选项（支持底层 input / span / li 三级点击）
- 判断题 → 匹配对/错/TRUE/FALSE，自动选中
- 填空题 → 向 UEditor / textarea / input 插入文本（多空用 `|` 分隔）

## 项目结构

```
xuexitong-auto-answer/
├── manifest.json           # Manifest V3 配置
├── background.js           # Service Worker（API 调用、缓存、重试）
├── content.js              # 内容脚本（题目提取、UI、自动填答、一键流程）
├── content.css             # 浮动面板 + 答案面板 + OCR 标签样式
├── ocr.js                  # OCR 模块（tesseract.js + html2canvas 封装）
├── lib/                    # 第三方库（打包到扩展中，避免 CSP 问题）
│   ├── tesseract.min.js
│   ├── worker.min.js
│   └── html2canvas.min.js
├── popup/
│   ├── popup.html          # 设置页
│   ├── popup.js            # 设置页逻辑
│   └── popup.css           # 设置页样式
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## OCR 识别原理

课程内测页使用 `font-cxsecret` 加密字体，DOM 中的文本是乱码。插件通过以下方式解决：

1. **html2canvas** — 将题干区域和选项区域截图为 Canvas
2. **tesseract.js** — 对截图进行 OCR 文字识别（中文简体）
3. **文本后处理** — 去除加密字体导致的字间多余空格，清洗题型前缀

库文件通过 manifest.json 的 `content_scripts.js` 静态注入，避免触发页面 CSP。

## 支持的 API 服务

插件使用 OpenAI 兼容接口格式，通过修改 Base URL 支持任意兼容服务：

| 服务 | Base URL |
|------|----------|
| 阿里百炼（默认） | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| 其他兼容服务 | 填入对应地址即可 |

## 技术细节

### 题目提取

支持两种页面结构：

**作业页（dowork）**：

```
div[id^="question"].questionLi     ← 题目容器
├── h3.mark_name                   ← 题干
│   └── span.colorShallow          ← 题型标签 "(单选题)"
└── div.stem_answer
    └── div.answerBg               ← 选项（span.num_option[data] 为选项字母）
```

**课程内测页（doHomeWorkNew）**：

```
div[id^="question"]                ← 题目容器
├── div.Zy_TItle                   ← 题干区域
│   └── span.newZy_TItle           ← 题型标签
│   └── div.fontLabel              ← 题干文本（加密字体，需 OCR）
└── ul.Zy_ulTop                    ← 选项列表
    └── li                         ← 单个选项（span.num_option + a.after）
```

### 答案缓存

- **前端缓存**：localStorage（`xxt_answer_cache`），按题干文本做 key，跨页面持久化
- **后端缓存**：background.js 内存 Map，同一次插件生命周期内有效，避免重复 API 调用
- **模糊匹配**：填答时对缓存 key 做去空格匹配，容忍 OCR 两次识别的微小差异

### 重试机制

API 调用失败自动重试 3 次，指数退避延迟（2s → 4s → 8s），429 和 5xx 错误触发重试。

## 常见问题

**Q: 提示"未检测到题目"？**
A: 确认当前页面是学习通作业/考试页面（URL 包含 `/mooc-ans/mooc2/work/dowork` 或 `/mooc-ans/work/doHomeWorkNew`）。如果页面还在加载中，等待几秒后重试。

**Q: 课程内测页题目是乱码？**
A: 课程内测页使用加密字体，DOM 文本是乱码。点击「一键」或「OCR」按钮，插件会自动截图识别实际显示的文字。

**Q: OCR 识别不准确？**
A: OCR 识别准确率取决于截图质量和字体渲染。如果识别结果不理想，可以尝试点击「OCR」重新识别，或手动填入答案。

**Q: 选择题填答不对？**
A: 点击「预览」查看解析出的题目和选项是否正确。如果选项解析有误，欢迎提 Issue 附上页面 DOM 截图。

**Q: 填空题填不进去？**
A: 填空题使用 UEditor 富文本编辑器，插件尝试三种方式插入（UEditor API → contenteditable → iframe）。如果都失败，请手动填入。

**Q: 需要学习通的 token 吗？**
A: 不需要。插件在已登录的页面上运行，通过 content script 直接操作 DOM，无需额外鉴权。

## License

MIT
