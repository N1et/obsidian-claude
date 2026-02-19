import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
  Notice,
  App,
} from 'obsidian';
import type ClaudePlugin from '../main';
import { runClaude } from '../claude-runner';
import { buildInlinePrompt } from '../prompt-templates';

interface AISuggestion {
  label: string;
  action: string; // internal action key or custom prompt text
}

const SUGGESTIONS: AISuggestion[] = [
  { label: 'Continue writing...', action: 'continue' },
  { label: 'Summarize note', action: 'summarize' },
  { label: 'Generate outline', action: 'outline' },
];

export class InlineAISuggest extends EditorSuggest<AISuggestion> {
  plugin: ClaudePlugin;

  constructor(app: App, plugin: ClaudePlugin) {
    super(app);
    this.plugin = plugin;
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    const match = line.match(/^\/ai\s(.*)$/);
    if (!match) return null;

    return {
      start: { line: cursor.line, ch: 0 },
      end: { line: cursor.line, ch: line.length },
      query: match[1],
    };
  }

  getSuggestions(context: EditorSuggestContext): AISuggestion[] {
    const query = context.query.toLowerCase().trim();

    // Always include predefined suggestions that match
    const filtered = SUGGESTIONS.filter(s =>
      s.label.toLowerCase().includes(query) || query === ''
    );

    // Add custom prompt option if user typed something
    if (query && !SUGGESTIONS.some(s => s.action === query)) {
      filtered.push({
        label: `Run: "${context.query}"`,
        action: context.query,
      });
    }

    return filtered;
  }

  renderSuggestion(suggestion: AISuggestion, el: HTMLElement): void {
    el.createSpan({ text: suggestion.label });
  }

  async selectSuggestion(suggestion: AISuggestion, _evt: MouseEvent | KeyboardEvent): Promise<void> {
    if (!this.context) return;

    const editor = this.context.editor;
    const startLine = this.context.start.line;

    // Remove the /ai line
    const lineStart = { line: startLine, ch: 0 };
    const lineEnd = { line: startLine, ch: editor.getLine(startLine).length };
    editor.replaceRange('', lineStart, lineEnd);

    // Get note content for context
    const activeFile = this.app.workspace.getActiveFile();
    let noteContent = '';
    if (activeFile) {
      noteContent = await this.app.vault.cachedRead(activeFile);
      const maxChars = this.plugin.settings.contextMaxChars;
      if (noteContent.length > maxChars) {
        noteContent = noteContent.substring(0, maxChars);
      }
    }

    // Get preceding text for "continue" action
    const precedingText = editor.getRange(
      { line: 0, ch: 0 },
      { line: startLine, ch: 0 }
    );

    const prompt = buildInlinePrompt(suggestion.action, noteContent, precedingText);

    // Insert position is at the start of the cleared line
    const insertPos = { line: startLine, ch: 0 };
    let insertedLength = 0;

    const notice = new Notice('Claude is thinking...', 0);

    // Debounce streaming updates
    let pendingText = '';
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPending = () => {
      if (pendingText) {
        const currentOffset = editor.posToOffset(insertPos) + insertedLength;
        const pos = editor.offsetToPos(currentOffset);
        editor.replaceRange(pendingText, pos);
        insertedLength += pendingText.length;
        pendingText = '';
      }
    };

    runClaude({
      cliPath: this.plugin.settings.cliPath,
      prompt,
      model: this.plugin.settings.defaultModel || undefined,
      onData: (chunk) => {
        pendingText += chunk;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(flushPending, 50);
      },
      onDone: () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        flushPending();
        notice.hide();
      },
      onError: (err) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        flushPending();
        notice.hide();
        new Notice(`Error: ${err.message}`);
      },
    });
  }
}
