# ClawUI 需求文档（Gateway 新前端）

日期：2026-02-05

## 背景与定位
OpenClaw 的 Gateway 负责会话、模型、工具与事件的控制平面，现有 Control UI 与 WebChat 已经通过 Gateway WebSocket 工作。本需求为一个新的现代化聊天 UI（代号 ClawUI），在**已运行的 Gateway 服务**基础上，通过**另一个端口**提供前端访问，所有数据仍来自 Gateway WebSocket。

## 目标
- 提供类似 ChatGPT 的现代化聊天界面，简洁、清爽、动效明确。
- 在不改动 Gateway 运行方式的前提下，通过独立端口提供 UI。
- 完整支持会话列表、聊天流式输出、工具调用折叠展示、附件发送。
- 用户可自定义字体类型、字体大小、显示宽度、行距。

## 非目标
- 不重写 Gateway 协议或存储逻辑。
- 不直接读写本地会话文件，全部从 Gateway 查询。
- 不做移动端原生应用，仅 Web 前端。

## 用户故事
- 作为用户，我能看到现有会话列表并快速切换。
- 作为用户，我能新建会话并删除不需要的会话。
- 作为用户，我能发送文字、文件、图片，并在聊天区看到预览。
- 作为用户，我能看到 AI 流式输出，并在处理中看到思考动画。
- 作为用户，我能看到工具调用的摘要，点开后查看完整调用与返回。
- 作为用户，我可以通过斜杠命令操作会话与模型。
- 作为用户，我可以调节字体、行距、内容宽度，保证阅读舒适。

## 功能需求

**1）连接与认证**
- ClawUI 通过 Gateway WebSocket 连接数据平面。
- 需要支持 token 或 password 认证（使用 `connect` 请求中的 auth）。
- 首次远程连接可能触发设备配对要求，UI 需提示并给出处理指引（不自动绕过）。

**2）会话列表（左侧栏）**
- 左侧为会话列表，可折叠/隐藏。
- 会话列表需从 Gateway 读取（`sessions.list`），不读取本地文件。
- 支持：
  - 搜索/过滤（基于 label、最近更新、关键字）。
  - 会话预览：显示最近一条消息摘要或派生标题。
  - 会话创建：由用户命名并创建新的 sessionKey，创建后自动切换。
  - 会话删除：调用 `sessions.delete` 删除指定会话。
- 会话切换时加载完整历史（`chat.history`）。

**3）聊天主区域**
- 中央为对话区，气泡样式。
- 用户消息靠右，AI 消息靠左。
- 用户与 AI 头像可配置，默认使用 OpenClaw 主题头像。
- 支持 Markdown 渲染与代码块展示。

**4）输入区与发送**
- 输入框位于聊天区底部，支持多行输入。
- 支持发送文字、文件、图片。
- 发送后立即在 UI 中显示用户消息，随后等待流式 AI 回复。
- 附件显示：
  - 图片：直接预览缩略图。
  - 文件：显示文件名、大小、类型，提供可下载/查看的入口。

**5）流式输出与思考状态**
- `chat.send` 为非阻塞式，UI 需等待 `chat` 事件的 delta/final。
- AI 输出必须流式展示（逐字或分段更新）。
- AI 正在处理时显示“thinking”动画（简洁小动画）。

**6）工具调用展示**
- 工具调用必须可见，但默认折叠。
- 工具调用折叠区显示：工具名称、状态、简短摘要。
- 不区分工具调用与返回结果的样式或标签；用户点击展开后才显示完整调用与返回信息。
- 工具调用与主对话分层显示，不打断阅读流。

**7）斜杠命令**
- 输入 `/` 显示可用命令列表，支持键盘导航和自动补全。
- 命令列表至少包含：
  - `/status`（调用 `status`）
  - `/compact`（调用 `sessions.compact`）
  - `/model`（调用 `sessions.patch` 设置模型）
  - `/think`（调用 `sessions.patch` 设置 thinking level）
  - `/verbose`（调用 `sessions.patch`）
  - `/reasoning`（调用 `sessions.patch`）
  - `/usage`（调用 `sessions.patch`）
  - `/abort`（调用 `chat.abort`）
  - `/new` 或 `/reset`（调用 `sessions.reset`）
- 上述命令必须由 Gateway 处理，**不得直接发送给模型**。

**8）会话信息区**
- 输入框下方显示当前会话信息：
  - 模型（显示当前模型，`/model` 切换后实时更新）
  - context 用量（contextTokens、inputTokens、outputTokens、totalTokens）
  - thinking 深度（thinkingLevel）
- 数据来源：`sessions.list`、`sessions.patch`、`chat.history` 返回的会话信息字段。

**9）可定制排版与主题**
- 必须提供 UI 设置入口：
  - 字体类型（font-family）
  - 字体大小
  - 行距（line-height）
  - 显示宽度（内容最大宽度）
- 设置实时生效并持久化（localStorage）。
- 样式以 Tailwind CSS 为基础，允许少量自定义 CSS 变量。

**10）动画与动效**
- 页面载入：渐入 + 轻微位移动效。
- 新消息出现：轻微上浮或淡入。
- thinking：点状或流光动画。
- 工具调用展开/收起：高度过渡 + 轻微阴影变化。
- 动效必须克制，不影响阅读与性能。

## 交互与状态处理
- Gateway 断开时：显示只读状态与重连提示。
- 会话为空时：显示引导文案与示例提示。
- 发送失败：保留输入内容，并在聊天区显示错误提示。
- 流式中断：显示中断状态并允许继续发送。

## 数据与协议对接（最小集）
- WebSocket 连接必须先发送 `connect`。
- 主要方法：
  - `chat.history`
  - `chat.send`
  - `chat.abort`
  - `chat.inject`
  - `sessions.list`
  - `sessions.preview`
  - `sessions.patch`
  - `sessions.delete`
  - `sessions.reset`
  - `sessions.compact`
  - `models.list`
  - `status`
- 主要事件：
  - `chat`（流式 delta + final）
  - `agent`（工具调用与执行状态）

## 端口与部署
- ClawUI 独立运行在一个新端口，不与 Gateway HTTP/WS 端口冲突。
- UI 静态资源可由独立前端服务提供（如 Vite dev/build），数据面仍连接 Gateway WS。
- UI 需要允许用户在设置中配置 Gateway WS 地址。

## 交付物
- `clawUI/requirements.md`（本需求文档）。
- 后续实现与设计稿将基于本需求拆分任务。

## 已确认
- 新会话由用户命名。
- 模型展示为当前模型，`/model` 切换后实时更新。
- 工具调用与返回不做区分，完整信息仅在展开后可见。
