const { Plugin, PluginSettingTab, Setting, Modal, Notice, requestUrl } = require('obsidian');
const { localBase } = require('./loopback');

const DEFAULT_SETTINGS = {
  apiBase: 'http://127.0.0.1:8765',
  processorEndpoint: 'http://127.0.0.1:11434',
  processorModel: '',
};

class VoiceMemoryPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new VoiceMemorySettingsTab(this.app, this));
    this.addCommand({
      id: 'open-record',
      name: '打开语音记录与证据',
      callback: () => this.openRecord(),
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      const recordId = this.recordIdForFile(file);
      if (!recordId) return;
      menu.addItem(item => item.setTitle('在 Voice Memory 中复核')
        .setIcon('audio-lines')
        .onClick(() => new VoiceMemoryRecordModal(this.app, this, recordId).open()));
    }));
  }

  recordIdForFile(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const value = frontmatter?.voice_memory_id;
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
  }

  async openRecord() {
    const active = this.app.workspace.getActiveFile();
    const recordId = active && this.recordIdForFile(active);
    if (recordId) {
      new VoiceMemoryRecordModal(this.app, this, recordId).open();
      return;
    }
    new RecordIdModal(this.app, value => new VoiceMemoryRecordModal(this.app, this, value).open()).open();
  }

  async request(path, method = 'GET', payload) {
    const base = localBase(this.settings.apiBase);
    const response = await requestUrl({
      url: `${base}${path}`,
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.json?.error || `本机服务返回 HTTP ${response.status}`);
    }
    return response.json;
  }

  async saveSettings() { await this.saveData(this.settings); }
}

class RecordIdModal extends Modal {
  constructor(app, onSubmit) { super(app); this.onSubmit = onSubmit; }
  onOpen() {
    this.titleEl.setText('打开语音记录');
    const input = this.contentEl.createEl('input', { type: 'text', placeholder: '粘贴记录 ID' });
    input.addClass('vm-record-id-input');
    const button = this.contentEl.createEl('button', { text: '打开记录' });
    button.addClass('mod-cta');
    button.addEventListener('click', () => {
      const id = input.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
        new Notice('记录 ID 格式无效');
        return;
      }
      this.close();
      this.onSubmit(id);
    });
    input.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class SpeakerNameModal extends Modal {
  constructor(app, currentName, onSubmit) { super(app); this.currentName = currentName; this.onSubmit = onSubmit; }
  onOpen() {
    this.titleEl.setText('确认本次记录中的说话人');
    this.contentEl.createEl('p', { text: '此操作只确认当前记录，不会建立或保存声纹档案。' });
    const input = this.contentEl.createEl('input', { type: 'text', value: this.currentName, placeholder: '说话人名称或 Wikilink' });
    const button = this.contentEl.createEl('button', { text: '确认此记录' });
    button.addClass('mod-cta');
    button.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return new Notice('请填写人物名称');
      this.close();
      this.onSubmit(value);
    });
    input.focus();
    input.select();
  }
  onClose() { this.contentEl.empty(); }
}

class ReprocessApprovalModal extends Modal {
  constructor(app, plugin, recordId, preview, onApproved) {
    super(app);
    this.plugin = plugin;
    this.recordId = recordId;
    this.preview = preview;
    this.onApproved = onApproved;
    this.finished = false;
  }
  onOpen() {
    this.titleEl.setText('写入前复核重编译差异');
    this.contentEl.createEl('p', { text: '以下差异覆盖本次重新整理将影响的所有 Vault 笔记。批准之前不会修改笔记。' });
    const list = this.contentEl.createDiv({ cls: 'vm-preview-files' });
    for (const file of this.preview.files || []) {
      const section = list.createDiv({ cls: 'vm-preview-file' });
      section.createEl('h3', { text: file.path });
      section.createEl('pre', { cls: 'vm-diff', text: file.diff || '内容无变化。' });
    }
    this.status = this.contentEl.createEl('p', { cls: 'vm-preview-status', text: `预览 ${this.preview.expires_in_seconds} 秒后失效。` });
    const actions = this.contentEl.createDiv({ cls: 'vm-preview-actions' });
    const cancel = actions.createEl('button', { text: '暂不写入' });
    cancel.addEventListener('click', () => this.cancel());
    this.approve = actions.createEl('button', { text: '确认写入这些更改' });
    this.approve.addClass('mod-cta');
    this.approve.addEventListener('click', () => this.approvePreview());
  }
  async approvePreview() {
    this.approve.disabled = true;
    this.status.setText('正在检查记录与笔记是否仍和预览一致…');
    try {
      const result = await this.plugin.request(`/records/${encodeURIComponent(this.recordId)}/reprocess/approve`, 'POST', {
        preview_id: this.preview.preview_id,
      });
      this.finished = true;
      this.close();
      new Notice(`已批准写入 ${result.files.length} 个 Vault 笔记，并保留回滚快照`);
      await this.onApproved(result);
    } catch (error) {
      this.status.setText(`尚未确认写入状态：${error.message}。可以再次确认以安全重试；若记录或笔记已变化，请关闭并重新生成预览。`);
      this.approve.disabled = false;
    }
  }
  async cancel() {
    this.finished = true;
    try {
      await this.plugin.request(`/records/${encodeURIComponent(this.recordId)}/reprocess/cancel`, 'POST', {
        preview_id: this.preview.preview_id,
      });
    } catch { /* expiration also discards the preview */ }
    this.close();
  }
  onClose() {
    if (!this.finished) {
      this.plugin.request(`/records/${encodeURIComponent(this.recordId)}/reprocess/cancel`, 'POST', {
        preview_id: this.preview.preview_id,
      }).catch(() => {});
    }
    this.contentEl.empty();
  }
}

class VoiceMemoryRecordModal extends Modal {
  constructor(app, plugin, recordId) { super(app); this.plugin = plugin; this.recordId = recordId; this.sidecar = null; }

  async onOpen() { await this.load(); }

  async load() {
    this.contentEl.empty();
    this.titleEl.setText('Voice Memory · 证据复核');
    this.contentEl.createEl('p', { text: '正在读取本机记录…', cls: 'vm-status' });
    try {
      this.sidecar = await this.plugin.request(`/records/${encodeURIComponent(this.recordId)}`);
      this.render();
    } catch (error) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: `无法加载记录：${error.message}`, cls: 'vm-error' });
      this.contentEl.createEl('p', { text: '确认桌面端 Voice Memory 正在运行，并检查插件设置中的本机服务地址。' });
    }
  }

  render() {
    this.contentEl.empty();
    const record = this.sidecar.record;
    this.titleEl.setText(record.title);
    const toolbar = this.contentEl.createDiv({ cls: 'vm-toolbar' });
    const audio = toolbar.createEl('audio', { attr: { controls: true, preload: 'metadata' } });
    if (record.audio_asset_id) {
      audio.crossOrigin = 'anonymous';
      audio.src = `${localBase(this.plugin.settings.apiBase)}/ledger/${encodeURIComponent(record.audio_asset_id)}/content`;
      this.audio = audio;
    } else {
      audio.controls = false;
      this.audio = null;
      toolbar.createEl('span', { text: '此记录没有关联音频资产' });
    }
    const legacy = this.sidecar.analysis;
    const legacyProfile = legacy?.profile || record.primary_mode;
    const views = this.sidecar.analysis_views || (legacy ? { [legacyProfile]: legacy } : {});
    const freshness = this.sidecar.analysis_views_current || {};
    const currentViews = Object.entries(views).filter(([profile]) => freshness[profile]);
    if (currentViews.length) {
      const section = this.contentEl.createDiv({ cls: 'vm-analysis' });
      section.createEl('h3', { text: '本机模型候选 · 待复核' });
      for (const [profile, analysis] of currentViews) {
        section.createEl('h4', { text: profile });
        if (analysis.summary?.text) this.addClaim(section, analysis.summary.text, analysis.summary.evidence_ids || []);
        for (const finding of analysis.findings || []) this.addClaim(section, finding.text, finding.evidence_ids || [], finding.kind);
      }
    }
    const segments = this.contentEl.createDiv({ cls: 'vm-segments' });
    segments.createEl('h3', { text: `原文转写 · ${(record.segments || []).length} 段` });
    for (const segment of record.segments || []) this.addSegment(segments, segment);
    const footer = this.contentEl.createDiv({ cls: 'vm-footer' });
    const profile = footer.createEl('select');
    for (const [key, value] of Object.entries(this.sidecar.profiles || {})) {
      profile.createEl('option', { text: value.name, value: key });
    }
    if (!profile.options.length) {
      for (const [key, label] of Object.entries({ knowledge: '知识学习', decision: '方案与决策', interview: '访谈与调研', negotiation: '商务谈判', relationship: '关系与日常对话', evidence: '记录与证据', operations: '会议与运营' })) {
        profile.createEl('option', { text: label, value: key });
      }
    }
    profile.value = record.primary_mode;
    const compile = footer.createEl('button', { text: '重新整理并查看差异' });
    compile.addClass('mod-cta');
    compile.disabled = !this.plugin.settings.processorModel.trim();
    compile.addEventListener('click', () => this.recompile(profile.value, compile));
    if (!this.plugin.settings.processorModel.trim()) footer.createEl('span', { text: '请先在插件设置中配置本机 Ollama 模型' });
  }

  addClaim(parent, text, evidenceIds, kind) {
    const claim = parent.createDiv({ cls: 'vm-claim' });
    if (kind) claim.createEl('strong', { text: kind });
    claim.createEl('p', { text: text || '未命名候选' });
    for (const id of evidenceIds) {
      const segment = this.sidecar.record.segments.find(item => item.id === id);
      if (segment) this.addEvidenceButton(claim, segment);
    }
  }

  addEvidenceButton(parent, segment) {
    const button = parent.createEl('button', { text: `↗ ${this.time(segment.start)} · ${segment.speaker || '未知说话人'}` });
    button.addClass('vm-evidence-link');
    button.addEventListener('click', () => this.jump(segment));
  }

  addSegment(parent, segment) {
    const card = parent.createDiv({ cls: `vm-segment ${segment.overlap ? 'is-overlap' : ''}` });
    card.dataset.segmentId = segment.id;
    const head = card.createDiv({ cls: 'vm-segment-head' });
    const jump = head.createEl('button', { text: `${this.time(segment.start)}–${this.time(segment.end)} · ${segment.speaker || '未知说话人'}` });
    jump.addEventListener('click', () => this.jump(segment));
    const confidence = segment.confidence == null ? '置信度未知' : `置信度 ${Math.round(segment.confidence * 100)}%`;
    head.createEl('span', { text: `${this.status(segment.speaker_status)} · ${confidence}${segment.overlap ? ' · 重叠发言' : ''}${segment.unclear ? ' · 不清楚' : ''}` });
    card.createEl('p', { text: segment.text });
    const confirm = card.createEl('button', { text: '确认本次说话人' });
    confirm.addEventListener('click', () => new SpeakerNameModal(this.app, segment.speaker, name => this.confirmSpeaker(segment, name)).open());
  }

  async confirmSpeaker(segment, name) {
    try {
      await this.plugin.request(`/records/${encodeURIComponent(this.recordId)}/corrections`, 'POST', {
        type: 'relabel', segment_id: segment.id, speaker: name, speaker_status: 'confirmed',
      });
      new Notice('已确认当前记录中的说话人');
      await this.load();
    } catch (error) { new Notice(`保存失败：${error.message}`); }
  }

  async recompile(profile, button) {
    button.disabled = true;
    try {
      const result = await this.plugin.request(`/records/${encodeURIComponent(this.recordId)}/reprocess`, 'POST', {
        primary_mode: profile,
        processor_endpoint: this.plugin.settings.processorEndpoint,
        processor_model: this.plugin.settings.processorModel,
      });
      new ReprocessApprovalModal(this.app, this.plugin, this.recordId, result, async () => {
        await this.load();
      }).open();
    } catch (error) {
      new Notice(`本机重编译失败：${error.message}`);
    } finally { button.disabled = false; }
  }

  jump(segment) {
    const article = [...this.contentEl.querySelectorAll('.vm-segment')]
      .find(item => item.dataset.segmentId === segment.id);
    article?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    article?.classList.add('is-target');
    window.setTimeout(() => article?.classList.remove('is-target'), 1600);
    if (this.audio && Number.isFinite(segment.start)) {
      this.audio.currentTime = segment.start;
      this.audio.play().catch(() => new Notice('无法播放音频，请检查本机服务或音频文件。'));
    }
  }

  time(value) {
    const seconds = Math.max(0, Math.floor(value || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  status(value) { return ({ confirmed: '已确认', suggestion: '建议', unknown: '未知' })[value] || '未知'; }
  onClose() { this.contentEl.empty(); }
}

class VoiceMemorySettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Voice Memory · 本机连接' });
    containerEl.createEl('p', { text: '插件只连接本机服务，不支持云端或远程地址。' });
    new Setting(containerEl).setName('Voice Memory API').setDesc('桌面端本机 API 地址')
      .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.apiBase).setValue(this.plugin.settings.apiBase)
        .onChange(async value => { this.plugin.settings.apiBase = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Ollama 地址').setDesc('仅用于本机语义重编译')
      .addText(text => text.setPlaceholder(DEFAULT_SETTINGS.processorEndpoint).setValue(this.plugin.settings.processorEndpoint)
        .onChange(async value => { this.plugin.settings.processorEndpoint = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('Ollama 模型')
      .addText(text => text.setPlaceholder('例如 qwen3:8b').setValue(this.plugin.settings.processorModel)
        .onChange(async value => { this.plugin.settings.processorModel = value.trim(); await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName('检查本机服务').addButton(button => button.setButtonText('连接检查')
      .onClick(async () => {
        try {
          await this.plugin.request('/health');
          new Notice('Voice Memory 本机服务连接成功');
        } catch (error) { new Notice(`连接失败：${error.message}`); }
      }));
  }
}

module.exports = VoiceMemoryPlugin;
