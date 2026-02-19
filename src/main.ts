import { Plugin } from 'obsidian';
import { ClaudePluginSettings, DEFAULT_SETTINGS, ClaudeSettingTab } from './settings';
import { CHAT_VIEW_TYPE, ChatView } from './features/chat-view';
import { registerTextTransformCommands } from './features/text-transform';
import { registerContextMenu } from './features/context-menu';
import { InlineAISuggest } from './features/inline-ai-suggest';
import { killAllProcesses } from './claude-runner';

export default class ClaudePlugin extends Plugin {
  settings: ClaudePluginSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // Register settings tab
    this.addSettingTab(new ClaudeSettingTab(this.app, this));

    // Register chat view
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // Add ribbon icon to open chat
    this.addRibbonIcon('message-square', 'Open Claude Chat', () => {
      this.activateChatView();
    });

    // Command to open chat panel
    this.addCommand({
      id: 'open-chat',
      name: 'Open Chat Panel',
      callback: () => this.activateChatView(),
    });

    // Register text transform commands
    registerTextTransformCommands(this);

    // Register context menu items
    registerContextMenu(this);

    // Register inline /ai suggest
    this.registerEditorSuggest(new InlineAISuggest(this.app, this));
  }

  onunload() {
    killAllProcesses();
  }

  async activateChatView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
