import { Editor, Notice, Modal, App, Setting } from 'obsidian';
import type ClaudePlugin from '../main';
import { runClaude, killProcess } from '../claude-runner';
import { buildTransformPrompt, TransformType } from '../prompt-templates';

interface TransformCommand {
  id: string;
  name: string;
  type: TransformType;
}

const TRANSFORMS: TransformCommand[] = [
  { id: 'improve-writing', name: 'AI: Improve Writing', type: 'improve' },
  { id: 'fix-grammar', name: 'AI: Fix Grammar', type: 'grammar' },
  { id: 'make-shorter', name: 'AI: Make Shorter', type: 'shorter' },
  { id: 'make-longer', name: 'AI: Make Longer', type: 'longer' },
  { id: 'summarize', name: 'AI: Summarize', type: 'summarize' },
  { id: 'explain-simply', name: 'AI: Explain Simply', type: 'explain' },
  { id: 'continue-writing', name: 'AI: Continue Writing', type: 'continue' },
];

export { TRANSFORMS };

export function registerTextTransformCommands(plugin: ClaudePlugin) {
  // Standard transform commands
  for (const cmd of TRANSFORMS) {
    plugin.addCommand({
      id: cmd.id,
      name: cmd.name,
      editorCallback: (editor: Editor) => {
        executeTransform(plugin, editor, cmd.type);
      },
    });
  }

  // Translate command — opens language picker modal
  plugin.addCommand({
    id: 'translate',
    name: 'AI: Translate',
    editorCallback: (editor: Editor) => {
      new TranslateModal(plugin.app, (language) => {
        executeTransform(plugin, editor, 'translate', language);
      }).open();
    },
  });

  // Custom prompt command — opens free-form input modal
  plugin.addCommand({
    id: 'custom-prompt',
    name: 'AI: Custom Prompt',
    editorCallback: (editor: Editor) => {
      new CustomPromptModal(plugin.app, (instruction) => {
        executeTransform(plugin, editor, 'custom', instruction);
      }).open();
    },
  });
}

export function executeTransform(
  plugin: ClaudePlugin,
  editor: Editor,
  type: TransformType,
  extra?: string,
) {
  const selection = editor.getSelection();
  if (!selection) {
    new Notice('Select some text first.');
    return;
  }

  const prompt = buildTransformPrompt(type, selection, extra);
  const notice = new Notice('Claude is thinking...', 0);

  const proc = runClaude({
    cliPath: plugin.settings.cliPath,
    prompt,
    model: plugin.settings.defaultModel || undefined,
    onDone: (result) => {
      notice.hide();
      const trimmed = result.trim();
      if (trimmed) {
        editor.replaceSelection(trimmed);
        new Notice('Text transformed.');
      } else {
        new Notice('No response from Claude.');
      }
    },
    onError: (err) => {
      notice.hide();
      new Notice(`Error: ${err.message}`);
    },
  });

  // Allow cancellation via new notice
  const cancelNotice = new Notice('Click to cancel...', 0);
  cancelNotice.noticeEl.addEventListener('click', () => {
    killProcess(proc);
    notice.hide();
    cancelNotice.hide();
    new Notice('Cancelled.');
  });

  proc.on('close', () => cancelNotice.hide());
}

class TranslateModal extends Modal {
  private onSubmit: (language: string) => void;

  constructor(app: App, onSubmit: (language: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Translate to...' });

    const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese', 'Italian', 'Japanese', 'Chinese', 'Korean', 'Russian'];

    let selected = 'English';
    new Setting(contentEl)
      .setName('Target language')
      .addDropdown(dropdown => {
        for (const lang of languages) {
          dropdown.addOption(lang, lang);
        }
        dropdown.setValue(selected);
        dropdown.onChange(val => { selected = val; });
      });

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Translate')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(selected);
        }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class CustomPromptModal extends Modal {
  private onSubmit: (instruction: string) => void;

  constructor(app: App, onSubmit: (instruction: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Custom AI Prompt' });
    contentEl.createEl('p', {
      text: 'Enter an instruction for Claude to apply to the selected text.',
      cls: 'setting-item-description',
    });

    const textArea = contentEl.createEl('textarea', {
      attr: { rows: '4', placeholder: 'e.g., Convert to bullet points' },
    });
    textArea.style.width = '100%';
    textArea.style.resize = 'vertical';
    textArea.style.marginBottom = '12px';

    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Run')
        .setCta()
        .onClick(() => {
          const instruction = textArea.value.trim();
          if (instruction) {
            this.close();
            this.onSubmit(instruction);
          }
        }));

    // Focus the textarea after render
    setTimeout(() => textArea.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}
