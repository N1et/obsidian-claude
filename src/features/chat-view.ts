import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, TFile, MarkdownView, FuzzySuggestModal, App } from 'obsidian';
import type ClaudePlugin from '../main';
import { runClaude, killProcess } from '../claude-runner';
import { ChildProcess } from 'child_process';
import { parseVaultActions, parseReadFileRequests, executeVaultAction, getActionLabel, getActionIcon, VaultAction, VAULT_SYSTEM_PROMPT } from '../vault-actions';

export const CHAT_VIEW_TYPE = 'claude-chat-view';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

class NotePickerModal extends FuzzySuggestModal<TFile> {
  private onChoose: (file: TFile) => void;

  constructor(app: App, onChoose: (file: TFile) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Pick a note to add as context...');
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onChoose(item);
  }
}

export class ChatView extends ItemView {
  plugin: ClaudePlugin;
  messages: ChatMessage[] = [];
  activeProcess: ChildProcess | null = null;
  isGenerating = false;
  activeNoteFile: TFile | null = null;   // auto-tracks the open note
  pinnedContextFiles: TFile[] = [];       // manually added notes
  autoEditMode = false;

  private chatContainer!: HTMLElement;
  private contextArea!: HTMLElement;
  private contextChipsContainer!: HTMLElement;
  private modeToggleBtn!: HTMLButtonElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private clearBtn!: HTMLButtonElement;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Claude Chat';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('claude-chat-container');

    // Header
    const header = container.createDiv({ cls: 'claude-chat-header' });
    header.createSpan({ text: 'Claude Chat', cls: 'claude-chat-title' });

    const headerActions = header.createDiv({ cls: 'claude-chat-header-actions' });

    this.modeToggleBtn = headerActions.createEl('button', {
      text: 'Ask',
      cls: 'claude-mode-toggle',
    });
    this.modeToggleBtn.addEventListener('click', () => this.toggleMode());
    this.updateModeButton();

    this.clearBtn = headerActions.createEl('button', {
      text: 'Clear',
      cls: 'claude-chat-clear-btn',
    });
    this.clearBtn.addEventListener('click', () => this.clearChat());

    // Chat messages area
    this.chatContainer = container.createDiv({ cls: 'claude-chat-messages' });
    this.renderWelcome();

    // Input area
    const inputArea = container.createDiv({ cls: 'claude-chat-input-area' });

    // Context area — label + chips + add button
    this.contextArea = inputArea.createDiv({ cls: 'claude-context-area' });

    const contextHeader = this.contextArea.createDiv({ cls: 'claude-context-header' });
    contextHeader.createSpan({ text: 'Context', cls: 'claude-context-label' });

    const addBtn = contextHeader.createEl('button', {
      text: '+',
      cls: 'claude-context-add-btn',
      attr: { title: 'Add note as context' },
    });
    addBtn.addEventListener('click', () => {
      new NotePickerModal(this.app, (file) => {
        if (!this.pinnedContextFiles.some(f => f.path === file.path)) {
          this.pinnedContextFiles.push(file);
          this.renderContextChips();
        }
      }).open();
    });

    this.contextChipsContainer = this.contextArea.createDiv({ cls: 'claude-context-chips' });

    // Set initial active note
    this.activeNoteFile = this.app.workspace.getActiveFile();
    this.renderContextChips();

    // Auto-track the active note when user switches tabs
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView && leaf.view.file) {
          this.activeNoteFile = leaf.view.file;
          this.renderContextChips();
        }
      })
    );

    this.inputEl = inputArea.createEl('textarea', {
      cls: 'claude-chat-input',
      attr: { placeholder: 'Ask Claude anything...', rows: '3' },
    });

    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const buttonRow = inputArea.createDiv({ cls: 'claude-chat-button-row' });

    this.stopBtn = buttonRow.createEl('button', {
      text: 'Stop',
      cls: 'claude-chat-stop-btn',
    });
    this.stopBtn.style.display = 'none';
    this.stopBtn.addEventListener('click', () => this.stopGeneration());

    this.sendBtn = buttonRow.createEl('button', {
      text: 'Send',
      cls: 'claude-chat-send-btn',
    });
    this.sendBtn.addEventListener('click', () => this.sendMessage());
  }

  async onClose() {
    this.stopGeneration();
  }

  private renderWelcome() {
    this.chatContainer.empty();
    const welcome = this.chatContainer.createDiv({ cls: 'claude-chat-welcome' });
    welcome.createEl('p', { text: 'Start a conversation with Claude.' });
    welcome.createEl('p', {
      text: 'Uses Claude Code CLI — no API key needed.',
      cls: 'claude-chat-welcome-sub',
    });
  }

  private async sendMessage() {
    const text = this.inputEl.value.trim();
    if (!text || this.isGenerating) return;

    this.inputEl.value = '';

    // Remove welcome message on first send
    if (this.messages.length === 0) {
      this.chatContainer.empty();
    }

    // Add user message
    this.messages.push({ role: 'user', content: text });
    this.renderMessage({ role: 'user', content: text });

    // Create assistant message bubble
    const assistantDiv = this.createAssistantBubble();
    const contentEl = assistantDiv.querySelector('.claude-chat-msg-content') as HTMLElement;

    await this.runClaudeWithReadLoop(assistantDiv, contentEl);
  }

  /**
   * Build prompt from current conversation state + context, call Claude,
   * and if the response contains <read-file> requests, fulfill them
   * and call Claude again automatically (up to maxReads rounds).
   */
  private async runClaudeWithReadLoop(
    assistantDiv: HTMLElement,
    contentEl: HTMLElement,
    maxReads = 5,
  ) {
    const prompt = await this.buildPrompt();
    const thinkingEl = this.showThinkingIndicator(contentEl);

    this.setGenerating(true);
    let fullResponse = '';
    let firstChunk = true;

    this.activeProcess = runClaude({
      cliPath: this.plugin.settings.cliPath,
      prompt,
      model: this.plugin.settings.defaultModel || undefined,
      onData: (chunk) => {
        if (firstChunk) {
          thinkingEl.remove();
          firstChunk = false;
        }
        fullResponse += chunk;
        contentEl.textContent = fullResponse;
        this.scrollToBottom();
      },
      onDone: async (result) => {
        fullResponse = result;
        this.activeProcess = null;

        // Check for <read-file> requests
        const { cleanText: textAfterReads, paths } = parseReadFileRequests(fullResponse);

        if (paths.length > 0 && maxReads > 0) {
          // Fulfill the read requests
          const fileContents = await this.readRequestedFiles(paths);

          // Add assistant's partial response + system file contents to conversation
          this.messages.push({ role: 'assistant', content: textAfterReads });
          this.messages.push({ role: 'user', content: fileContents });

          // Show reading status in bubble
          contentEl.empty();
          const statusEl = contentEl.createDiv({ cls: 'claude-thinking-indicator' });
          statusEl.createSpan({ text: `Reading ${paths.length} file(s)...`, cls: 'claude-thinking-text' });
          this.scrollToBottom();

          // Re-run Claude with the new file contents
          await this.runClaudeWithReadLoop(assistantDiv, contentEl, maxReads - 1);
          return;
        }

        // No more reads needed — finalize response
        this.messages.push({ role: 'assistant', content: fullResponse });
        this.setGenerating(false);

        // Parse vault actions from response
        const { cleanText, actions } = parseVaultActions(fullResponse);

        // Render clean text as markdown
        this.renderMarkdown(contentEl, cleanText);

        // Handle vault actions
        if (actions.length > 0) {
          if (this.autoEditMode) {
            this.autoExecuteActions(assistantDiv, actions);
          } else {
            this.renderActionButtons(assistantDiv, actions);
          }
        }

        this.scrollToBottom();
      },
      onError: (err) => {
        this.activeProcess = null;
        this.setGenerating(false);
        contentEl.textContent = `Error: ${err.message}`;
        contentEl.addClass('claude-chat-error');
        this.scrollToBottom();
      },
    });
  }

  private async buildPrompt(): Promise<string> {
    let prompt = VAULT_SYSTEM_PROMPT + '\n\n';

    // Include vault file tree so Claude knows all existing files
    const vaultTree = this.getVaultTree();
    prompt += `Vault file structure:\n${vaultTree}\n\n---\n`;

    // Collect all context files (active note + pinned), avoiding duplicates
    if (this.plugin.settings.includeNoteContext) {
      const allContext: TFile[] = [];
      if (this.activeNoteFile) allContext.push(this.activeNoteFile);
      for (const f of this.pinnedContextFiles) {
        if (!allContext.some(c => c.path === f.path)) allContext.push(f);
      }

      if (allContext.length > 0) {
        const maxChars = this.plugin.settings.contextMaxChars;
        prompt += `The user has provided the following notes as context. You can see their full content.\n\n`;
        for (const file of allContext) {
          try {
            const noteContent = await this.app.vault.cachedRead(file);
            const truncated = noteContent.length > maxChars
              ? noteContent.substring(0, maxChars) + '\n[...truncated]'
              : noteContent;
            prompt += `Note title: "${file.basename}"\nFull path in vault: "${file.path}"\nNote content:\n${truncated}\n\n`;
          } catch {
            // File may have been deleted
          }
        }
        prompt += `---\n`;
      }
    }

    // Include previous messages as conversation history
    const history = this.messages.slice(0, -1);
    if (history.length > 0) {
      prompt += 'Previous conversation:\n';
      for (const msg of history) {
        const label = msg.role === 'user' ? 'User' : 'Assistant';
        prompt += `${label}: ${msg.content}\n\n`;
      }
      prompt += '---\n';
    }

    // Last user message
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg) {
      prompt += `User: ${lastMsg.content}`;
    }

    return prompt;
  }

  private async readRequestedFiles(paths: string[]): Promise<string> {
    let result = 'Here are the contents of the files you requested:\n\n';
    for (const filePath of paths) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        try {
          const content = await this.app.vault.cachedRead(file);
          const maxChars = this.plugin.settings.contextMaxChars;
          const truncated = content.length > maxChars
            ? content.substring(0, maxChars) + '\n[...truncated]'
            : content;
          result += `--- File: "${file.path}" ---\n${truncated}\n\n`;
        } catch {
          result += `--- File: "${filePath}" --- (error reading file)\n\n`;
        }
      } else {
        result += `--- File: "${filePath}" --- (file not found)\n\n`;
      }
    }
    return result;
  }

  private createAssistantBubble(): HTMLElement {
    const msgDiv = this.chatContainer.createDiv({ cls: 'claude-chat-msg claude-chat-msg-assistant' });
    const label = msgDiv.createDiv({ cls: 'claude-chat-msg-label' });
    label.textContent = 'Claude';
    msgDiv.createDiv({ cls: 'claude-chat-msg-content' });
    return msgDiv;
  }

  private renderMessage(msg: ChatMessage) {
    const isUser = msg.role === 'user';
    const msgDiv = this.chatContainer.createDiv({
      cls: `claude-chat-msg claude-chat-msg-${msg.role}`,
    });
    const label = msgDiv.createDiv({ cls: 'claude-chat-msg-label' });
    label.textContent = isUser ? 'You' : 'Claude';
    const contentEl = msgDiv.createDiv({ cls: 'claude-chat-msg-content' });

    if (isUser) {
      contentEl.textContent = msg.content;
    } else {
      this.renderMarkdown(contentEl, msg.content);
    }

    this.scrollToBottom();
  }

  private async renderMarkdown(el: HTMLElement, markdown: string) {
    el.empty();
    await MarkdownRenderer.render(this.app, markdown, el, '', this.plugin);
  }

  private scrollToBottom() {
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  private setGenerating(generating: boolean) {
    this.isGenerating = generating;
    this.sendBtn.setAttr('disabled', generating ? 'true' : '');
    this.stopBtn.style.display = generating ? '' : 'none';
    this.inputEl.setAttr('disabled', generating ? 'true' : '');
    if (!generating) {
      this.inputEl.removeAttribute('disabled');
      this.sendBtn.removeAttribute('disabled');
      this.inputEl.focus();
    }
  }

  private stopGeneration() {
    if (this.activeProcess) {
      killProcess(this.activeProcess);
      this.activeProcess = null;
      this.setGenerating(false);
      new Notice('Generation stopped.');
    }
  }

  private getVaultTree(): string {
    const files = this.app.vault.getFiles()
      .filter(f => !f.path.startsWith('.'))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (files.length === 0) return '(empty vault)';

    // Limit to avoid huge prompts
    const maxFiles = 200;
    const lines = files.slice(0, maxFiles).map(f => f.path);
    if (files.length > maxFiles) {
      lines.push(`... and ${files.length - maxFiles} more files`);
    }
    return lines.join('\n');
  }

  private toggleMode() {
    this.autoEditMode = !this.autoEditMode;
    this.updateModeButton();
  }

  private updateModeButton() {
    if (this.autoEditMode) {
      this.modeToggleBtn.textContent = 'Edit';
      this.modeToggleBtn.addClass('claude-mode-edit');
      this.modeToggleBtn.removeClass('claude-mode-ask');
    } else {
      this.modeToggleBtn.textContent = 'Ask';
      this.modeToggleBtn.removeClass('claude-mode-edit');
      this.modeToggleBtn.addClass('claude-mode-ask');
    }
  }

  private async autoExecuteActions(msgDiv: HTMLElement, actions: VaultAction[]) {
    const actionsContainer = msgDiv.createDiv({ cls: 'claude-actions-container' });
    actionsContainer.createDiv({ cls: 'claude-actions-label', text: 'Auto-applied:' });

    for (const action of actions) {
      const row = actionsContainer.createDiv({ cls: 'claude-action-row' });
      const icon = row.createSpan({ cls: 'claude-action-icon' });
      icon.textContent = getActionIcon(action);
      const label = row.createSpan({ cls: 'claude-action-label' });

      try {
        const result = await executeVaultAction(this.app, action);
        label.textContent = result;
        label.addClass('claude-action-success');
      } catch (err: any) {
        label.textContent = `Failed: ${getActionLabel(action)} - ${err.message}`;
        label.addClass('claude-action-failed');
      }
    }
    this.scrollToBottom();
  }

  private renderActionButtons(msgDiv: HTMLElement, actions: VaultAction[]) {
    const actionsContainer = msgDiv.createDiv({ cls: 'claude-actions-container' });
    actionsContainer.createDiv({ cls: 'claude-actions-label', text: 'Vault actions:' });

    for (const action of actions) {
      const row = actionsContainer.createDiv({ cls: 'claude-action-row' });

      const icon = row.createSpan({ cls: 'claude-action-icon' });
      icon.textContent = getActionIcon(action);

      const label = row.createSpan({ cls: 'claude-action-label' });
      label.textContent = getActionLabel(action);

      const btn = row.createEl('button', {
        cls: 'claude-action-btn',
        text: 'Apply',
      });

      btn.addEventListener('click', async () => {
        btn.setAttr('disabled', 'true');
        btn.textContent = 'Applying...';
        try {
          const result = await executeVaultAction(this.app, action);
          btn.textContent = 'Done';
          btn.addClass('claude-action-btn-done');
          new Notice(result);
        } catch (err: any) {
          btn.textContent = 'Failed';
          btn.addClass('claude-action-btn-error');
          new Notice(`Error: ${err.message}`);
        }
      });
    }

    // "Apply All" button if multiple actions
    if (actions.length > 1) {
      const applyAll = actionsContainer.createEl('button', {
        cls: 'claude-action-apply-all',
        text: 'Apply All',
      });

      applyAll.addEventListener('click', async () => {
        applyAll.setAttr('disabled', 'true');
        applyAll.textContent = 'Applying...';
        const results: string[] = [];
        for (const action of actions) {
          try {
            results.push(await executeVaultAction(this.app, action));
          } catch (err: any) {
            results.push(`Error: ${err.message}`);
          }
        }
        // Mark all individual buttons as done
        actionsContainer.querySelectorAll('.claude-action-btn').forEach((btn) => {
          (btn as HTMLButtonElement).textContent = 'Done';
          (btn as HTMLButtonElement).setAttr('disabled', 'true');
          btn.addClass('claude-action-btn-done');
        });
        applyAll.textContent = 'All Applied';
        applyAll.addClass('claude-action-btn-done');
        new Notice(results.join('\n'));
      });
    }
  }

  private showThinkingIndicator(container: HTMLElement): HTMLElement {
    const thinkingMessages = [
      'Thinking...',
      'Reading your note...',
      'Analyzing context...',
      'Crafting a response...',
      'Almost there...',
      'Connecting the dots...',
      'Pondering deeply...',
      'Working on it...',
      'Processing your request...',
      'Gathering thoughts...',
    ];

    const el = container.createDiv({ cls: 'claude-thinking-indicator' });
    const dot = el.createSpan({ cls: 'claude-thinking-dots' });
    const msg = el.createSpan({ cls: 'claude-thinking-text' });

    let index = 0;
    msg.textContent = thinkingMessages[0];
    dot.textContent = '';

    // Animate dots
    let dotCount = 0;
    const dotInterval = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      dot.textContent = '.'.repeat(dotCount);
    }, 400);

    // Rotate messages
    const msgInterval = setInterval(() => {
      index = (index + 1) % thinkingMessages.length;
      msg.textContent = thinkingMessages[index];
    }, 3000);

    // Store intervals for cleanup
    const observer = new MutationObserver(() => {
      if (!el.isConnected) {
        clearInterval(dotInterval);
        clearInterval(msgInterval);
        observer.disconnect();
      }
    });
    observer.observe(container, { childList: true });

    this.scrollToBottom();
    return el;
  }

  private renderContextChips() {
    this.contextChipsContainer.empty();

    if (!this.plugin.settings.includeNoteContext) {
      this.contextArea.style.display = 'none';
      return;
    }

    this.contextArea.style.display = '';

    const hasAny = this.activeNoteFile || this.pinnedContextFiles.length > 0;

    if (!hasAny) {
      this.contextChipsContainer.createSpan({
        text: 'No note open. Click + to add context.',
        cls: 'claude-context-empty',
      });
      return;
    }

    // Active note chip — auto-tracks, visually distinct
    if (this.activeNoteFile) {
      const chip = this.contextChipsContainer.createDiv({ cls: 'claude-context-chip claude-context-chip-active' });
      chip.createSpan({ text: '\u{1F4C4}', cls: 'claude-context-chip-icon' });
      chip.createSpan({ text: this.activeNoteFile.basename, cls: 'claude-context-chip-name' });
      chip.createSpan({ text: 'active', cls: 'claude-context-chip-badge' });

      const removeBtn = chip.createSpan({ text: '\u00D7', cls: 'claude-context-chip-remove' });
      removeBtn.setAttribute('title', 'Stop tracking active note');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeNoteFile = null;
        this.renderContextChips();
      });
    }

    // Pinned context chips
    for (const file of this.pinnedContextFiles) {
      // Skip if same as active note (avoid visual duplicate)
      if (this.activeNoteFile && file.path === this.activeNoteFile.path) continue;

      const chip = this.contextChipsContainer.createDiv({ cls: 'claude-context-chip' });
      chip.createSpan({ text: '\u{1F4C4}', cls: 'claude-context-chip-icon' });
      chip.createSpan({ text: file.basename, cls: 'claude-context-chip-name' });

      const removeBtn = chip.createSpan({ text: '\u00D7', cls: 'claude-context-chip-remove' });
      removeBtn.setAttribute('title', 'Remove from context');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.pinnedContextFiles = this.pinnedContextFiles.filter(f => f.path !== file.path);
        this.renderContextChips();
      });
    }
  }

  private clearChat() {
    this.stopGeneration();
    this.messages = [];
    this.renderWelcome();
  }
}
