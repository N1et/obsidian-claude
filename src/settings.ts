import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ClaudePlugin from './main';
import { runClaude } from './claude-runner';

export interface ClaudePluginSettings {
  cliPath: string;
  defaultModel: string;
  includeNoteContext: boolean;
  contextMaxChars: number;
}

export const DEFAULT_SETTINGS: ClaudePluginSettings = {
  cliPath: 'claude',
  defaultModel: '',
  includeNoteContext: true,
  contextMaxChars: 8000,
};

export class ClaudeSettingTab extends PluginSettingTab {
  plugin: ClaudePlugin;

  constructor(app: App, plugin: ClaudePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Claude CLI path')
      .setDesc('Path to the Claude Code CLI executable. Default "claude" uses PATH.')
      .addText(text => text
        .setPlaceholder('claude')
        .setValue(this.plugin.settings.cliPath)
        .onChange(async (value) => {
          this.plugin.settings.cliPath = value || 'claude';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default model')
      .setDesc('Model to use (leave empty for default). Passed via --model flag.')
      .addText(text => text
        .setPlaceholder('e.g. claude-sonnet-4-5-20250514')
        .setValue(this.plugin.settings.defaultModel)
        .onChange(async (value) => {
          this.plugin.settings.defaultModel = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Include note context')
      .setDesc('Send the current note content as background context with prompts.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeNoteContext)
        .onChange(async (value) => {
          this.plugin.settings.includeNoteContext = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Context max characters')
      .setDesc('Maximum characters of note content to include as context.')
      .addText(text => text
        .setPlaceholder('8000')
        .setValue(String(this.plugin.settings.contextMaxChars))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num > 0) {
            this.plugin.settings.contextMaxChars = num;
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Test connection')
      .setDesc('Verify that the Claude CLI is accessible and working.')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          button.setButtonText('Testing...');
          button.setDisabled(true);

          runClaude({
            cliPath: this.plugin.settings.cliPath,
            prompt: 'Say "Hello from Claude!" and nothing else.',
            onDone: (text) => {
              new Notice(`Claude responded: ${text.trim()}`);
              button.setButtonText('Test');
              button.setDisabled(false);
            },
            onError: (err) => {
              new Notice(`Error: ${err.message}. Check your CLI path.`);
              button.setButtonText('Test');
              button.setDisabled(false);
            },
          });
        }));
  }
}
