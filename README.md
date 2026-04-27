# XXT Assistant - 学习通搜题助手

基于 Chrome Extension Manifest V3 的学习通自动搜题插件，调用大语言模型（阿里百炼/OpenAI 兼容接口）搜索答案并自动填答。

## 功能特性

- 自动识别学习通作业页面的全部题目（单选/多选/判断/填空）
- 调用 AI 模型搜索答案，支持自定义模型和 API 地址
- 答案本地缓存（localStorage），重复题目直接命中
- 自动填答：选择题点击选项、填空题插入文本（支持 UEditor 富文本编辑器）
- 可拖拽浮动控制面板 + 实时日志
- 答案缓存面板，随时查看历史答案

## 支持的题型

| 题型 | 提取 | 填答 |
|------|:----:|:----:|
| 单选题 | ✅ | ✅ |
| 多选题 | ✅ | ✅ |
| 判断题 | ✅ | ✅ |
| 填空题 | ✅ | ✅ |

## 安装

1. 克隆仓库

```bash
git clone https://github.com/ArtLjn/xuexitong-auto-answer.git
```

2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 开启右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择项目文件夹
5. 插件图标出现在浏览器工具栏

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

### 2. 搜题

1. 打开学习通作业/考试页面
2. 页面右下角出现浮动面板
3. 点击 **「搜题」** 按钮，自动提取全部题目并逐题搜索答案
4. 搜索完成后答案显示在每道题旁边

### 3. 填答

搜题完成后点击 **「填答」** 按钮，自动将缓存中的答案填入页面：

- 选择题 → 自动点击对应选项
- 判断题 → 自动点击"对"或"错"
- 填空题 → 自动向 UEditor 编辑器插入文本（多空用 `|` 分隔）

### 4. 查看答案

点击 **「答案」** 按钮打开侧边面板，查看所有已缓存的答案。

## 项目结构

```
xuexitong-auto-answer/
├── manifest.json           # Manifest V3 配置
├── background.js           # Service Worker（API 调用、缓存、重试）
├── content.js              # 内容脚本（题目提取、UI、自动填答）
├── content.css             # 浮动面板 + 答案面板样式
├── popup/
│   ├── popup.html          # 设置页
│   ├── popup.js            # 设置页逻辑
│   └── popup.css           # 设置页样式
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

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

学习通作业页面的 DOM 结构：

```
div[id^="question"].questionLi     ← 题目容器
├── h3.mark_name                   ← 题干
│   └── span.colorShallow          ← 题型标签 "(单选题)"
└── div.stem_answer
    └── div.answerBg               ← 选项（span.num_option[data] 为选项字母）
```

选择题通过 `span.num_option[data]` 属性匹配答案字母，填空题通过 UEditor API / contenteditable / iframe 三层降级插入。

### 答案缓存

- **前端缓存**：localStorage（`xxt_answer_cache`），按题干文本做 key，跨页面持久化
- **后端缓存**：background.js 内存 Map，同一次插件生命周期内有效，避免重复 API 调用

### 重试机制

API 调用失败自动重试 3 次，指数退避延迟（2s → 4s → 8s），429 和 5xx 错误触发重试。

## 常见问题

**Q: 提示"未检测到题目"？**
A: 确认当前页面是学习通作业/考试页面（URL 包含 `/mooc-ans/mooc2/work/dowork`）。如果页面还在加载中，等待几秒后重试。

**Q: 选择题填答不对？**
A: 点击「预览」查看解析出的题目和选项是否正确。如果选项解析有误，欢迎提 Issue 附上页面 DOM 截图。

**Q: 填空题填不进去？**
A: 填空题使用 UEditor 富文本编辑器，插件尝试三种方式插入（UEditor API → contenteditable → iframe）。如果都失败，请手动填入。

**Q: 需要学习通的 token 吗？**
A: 不需要。插件在已登录的页面上运行，通过 content script 直接操作 DOM，无需额外鉴权。

## License

MIT
