export type Release = {
  product?: "honeyvoice";
  version: string;
  date: string;
  title: string;
  summary: string;
  visual?: "filters" | "privacy" | "activity" | "updates";
  paragraphs: string[];
  highlights: string[];
  issues: { title: string; reference: string; status: "Open" | "Closed"; url: string }[];
};

export const releases: Release[] = [
  {
    product: "honeyvoice",
    version: "0.1.3",
    date: "2026-09-27",
    title: "中文操作与可靠的模型下载",
    summary: "补齐录音、摘要、对话及笔记操作的中文，修复服务商配置同步，并支持完整校验的模型镜像下载。",
    paragraphs: [
      "本地候选版本，尚未正式发布。模型下载可选择自动、镜像或官方来源，完整校验后才作为可用模型；失败时保留已有模型，不会把损坏文件当作下载完成。",
      "保留 Humla 的布局及 HoneyVoice 的淡蓝灰配色，补齐核心操作的中文。修复前端中文摘要模板错误回退到英文，以及首次打开笔记后窄窗口遮挡工具栏的问题。",
      "语言切换不会翻译或改写笔记内容。修复编辑器浮动菜单卸载错误，并避免切换只读状态时误触发正文保存。正式分发仍需完成签名、公证和安装验收。",
      "说话人模型下载在离开设置后继续保留状态，离线识别失败不会自动联网或清除模型。无法识别身份时保留转录和时间线，不再猜测为“说话人 1”或“你”。中文多人识别准确率仍未通过验收。",
      "摘要、对话和自定义提示词使用中文控件，用户内容及模型名称保持原样。保存或替换密钥后同步刷新模型列表；MiMo 接口需点击“保存地址”才生效，失败时保留原配置，旧请求不会覆盖新结果。设置窗口背后的聊天页也会同步更新配置。",
    ],
    highlights: [
      "镜像优先、完整性校验、明确的下载失败和重试入口。",
      "中文录音状态、转录设置、笔记菜单和编辑提示。",
      "修复中文模板语言和窄窗口核心按钮遮挡。",
      "编辑器语言和权限切换保持正文不变。",
      "识别失败明确提示，不用猜测的身份覆盖发言。",
      "中文摘要和对话设置，密钥、接口与聊天状态可靠同步。",
    ],
    issues: [],
  },
  {
    product: "honeyvoice",
    version: "0.1.2",
    date: "2026-09-26",
    title: "修复中文转录丢字",
    summary: "保留逐字时间轴中的完整中文，不再因字符分片而丢失文字。",
    paragraphs: [
      "真实中文样本发现，模型已识别出的字会在生成逐字时间轴时被丢弃。现在先拼接完整字符的原始字节，再生成时间信息，保留中文及其他多字节字符。",
      "时间信息不完整时退回完整段落文本，避免说话人整理覆盖正确的转录内容。保留原有 HoneyVoice 风格、蓝灰配色及本地录音流程。",
    ],
    highlights: [
      "修复中文、混合语言和表情字符跨分片时的丢字。",
      "异常时间信息不再替换完整转录文字。",
      "增加真实中文本地模型与字符分片回归测试。",
    ],
    issues: [],
  },
  {
    product: "honeyvoice",
    version: "0.1.1",
    date: "2026-09-26",
    title: "录音权限检查与 MiMo 连接改进",
    summary: "明确当前安装位置，支持重新检查权限，并根据 MiMo 接口选择可用模型。",
    paragraphs: [
      "权限页现在显示实际运行的应用位置，帮助识别同名旧版本。检查失败会提供重试入口，较早返回的权限查询也不会覆盖更新的授权结果。",
      "系统授权弹窗获得更充足的响应时间。MiMo 初次设置会查询你配置的接口支持的模型；Coding Plan 的真实摘要和流式聊天请求已通过测试。",
    ],
    highlights: [
      "显示当前应用路径和清晰的旧版授权恢复说明。",
      "可手动重新检查权限，查询失败时明确提示。",
      "修复权限请求过早超时及旧查询覆盖新状态。",
      "验证 MiMo Coding Plan 摘要和流式对话。",
    ],
    issues: [],
  },
  {
    product: "honeyvoice",
    version: "0.1.0",
    date: "2026-09-24",
    title: "Meet HoneyVoice",
    summary: "A local-first voice notebook, now shaped for HoneyVoice.",
    paragraphs: [
      "HoneyVoice keeps Humla’s open-source recording and note-taking foundation while giving it a calm, muted sky-blue identity and a focused personal-workspace experience.",
      "Choose supported AI providers such as DeepSeek and MiMo for summaries and chat. Your API keys stay in the macOS Keychain, and the app does not send anonymous usage counters by default.",
    ],
    highlights: [
      "A soft blue-gray HoneyVoice design, with light appearance as the default.",
      "Chinese is the default language for transcription and generated summaries.",
      "DeepSeek and MiMo support for summaries and note-aware chat.",
      "Local notes and provider credentials remain on your Mac.",
    ],
    issues: [],
  },
  {
    version: "0.64.0",
    date: "2026-09-21",
    title: "Keep a chat on one client",
    summary: "Pin a conversation to one client, or to one person’s speech.",
    paragraphs: [
      "Chat already lets you choose how much of your library a conversation can reach. Now you can also narrow it to a single client, or to the passages where one particular person was speaking. Set it once and every answer in that thread follows it — no need to repeat yourself each time you ask.",
      "Active filters sit just above the message box as small tags, so you can always see what a conversation is working from, and remove one with a single click.",
    ],
    highlights: [
      "Pin a conversation to one client.",
      "Narrow it to what one person said.",
      "See and clear active filters above the message box.",
    ],
    issues: [
      { title: "Chat: pin a conversation to one Client", reference: "#115", status: "Closed", url: "https://github.com/michaelwilhelmsen/humla/issues/115" },
    ],
  },
  {
    version: "0.63.0",
    date: "2026-09-20",
    title: "Claude joins the lineup",
    summary: "Summaries and chat with Anthropic, using your own API key.",
    paragraphs: [
      "You can now pick Anthropic as the provider for AI summaries and for chat over your notes. Add your Claude API key once under Settings, choose a model, and summaries stream into the panel just as they do with OpenAI.",
      "Model pickers are live for both cloud providers: Humla asks the API for the models your key can use, so new releases show up without waiting for an app update. Chat on Anthropic searches your notes by keyword, since Claude has no embeddings endpoint.",
    ],
    highlights: [
      "Choose Anthropic for summaries, per note or as the default.",
      "Chat over your notes with Claude, tools and citations included.",
      "OpenAI and Anthropic model lists come straight from your account.",
    ],
    issues: [
      { title: "Anthropic API as a summary (and chat) provider", reference: "#183", status: "Closed", url: "https://github.com/michaelwilhelmsen/humla/issues/183" },
    ],
  },
  {
    version: "0.62.0",
    date: "2026-09-15",
    title: "A home for what’s new",
    summary: "The latest from Humla, right on your home screen.",
    visual: "updates",
    paragraphs: [
      "Your home screen now shows the three latest releases, with the newest at the top. Open any entry for a closer look at the changes, illustrated with previews of the features.",
      "Related GitHub issues link directly to the work behind each release. Settings also gets a quieter look, with borderless panels, a sidebar that matches the app, and even padding.",
    ],
    highlights: [
      "Read detailed release notes without leaving Humla.",
      "Explore feature previews and related GitHub issues.",
      "Enjoy a cleaner, more consistent Settings panel.",
    ],
    issues: [],
  },
  {
    version: "0.61.0",
    issues: [],
    date: "2026-09-15",
    title: "Find the right note, faster",
    summary: "A little more order for a growing library.",
    visual: "filters",
    paragraphs: [
      "Your notes add up. Now you can narrow your library by what a note contains, which client it belongs to, and who created it — without remembering its title.",
      "The filter bar is available in All notes and inside folders. Combine filters to find exactly what you need, then clear them to see the full picture again.",
    ],
    highlights: [
      "Filter by notes, recordings, transcripts, or summaries.",
      "Narrow by client or, in a team workspace, by author.",
      "Find unfiled notes in All notes with the No folder filter.",
    ],
  },
  {
    version: "0.60.0",
    issues: [
      { title: "A note can be private inside a workspace", reference: "#191", status: "Closed", url: "https://github.com/michaelwilhelmsen/humla/issues/191" },
    ],
    date: "2026-09-14",
    title: "A little space for private notes",
    summary: "Keep a note to yourself, even in a team workspace.",
    visual: "privacy",
    paragraphs: [
      "Some notes are just for you. You can now keep a note private inside a shared workspace, so personal thoughts and early drafts can live alongside your team’s work.",
      "The note’s author controls its visibility. Notes that only one person can access also skip the shared recording lock, keeping personal recording sessions straightforward.",
    ],
    highlights: [
      "Choose whether a workspace note is private or shared.",
      "Only the author can change a note’s visibility.",
      "Permanently deleting a note also removes its version history.",
    ],
  },
  {
    version: "0.59.0",
    issues: [
      { title: "Note cards show no live activity (recording / transcribing / summarizing)", reference: "#190", status: "Closed", url: "https://github.com/michaelwilhelmsen/humla/issues/190" },
    ],
    date: "2026-09-11",
    title: "Know what’s happening at a glance",
    summary: "Live activity, right on your note cards.",
    visual: "activity",
    paragraphs: [
      "You no longer need to open a note to see whether Humla is still working on it. Note cards now show activity as it happens, so you can keep browsing while a recording or processing step is underway.",
      "A recording card also shows elapsed capture time. Its timer follows the recording itself, so navigating away and coming back won’t reset the clock.",
    ],
    highlights: [
      "See active recording and processing states on note cards.",
      "Follow elapsed recording time from your library.",
      "Return from an unfiled note directly to All notes.",
    ],
  },
];

export const latestReleases = releases
  .filter((release) => release.product === "honeyvoice")
  .sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, { numeric: true }))
  .slice(0, 3);
