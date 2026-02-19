import { Editor, EditorPosition } from 'obsidian';

/**
 * Get the full content of the editor.
 */
export function getEditorContent(editor: Editor): string {
  return editor.getValue();
}

/**
 * Get text before the cursor position.
 */
export function getTextBeforeCursor(editor: Editor): string {
  const cursor = editor.getCursor();
  return editor.getRange({ line: 0, ch: 0 }, cursor);
}

/**
 * Get text after the cursor position.
 */
export function getTextAfterCursor(editor: Editor): string {
  const cursor = editor.getCursor();
  const lastLine = editor.lastLine();
  const lastLineLength = editor.getLine(lastLine).length;
  return editor.getRange(cursor, { line: lastLine, ch: lastLineLength });
}

/**
 * Replace the current line with new text.
 */
export function replaceCurrentLine(editor: Editor, newText: string): void {
  const cursor = editor.getCursor();
  const lineLength = editor.getLine(cursor.line).length;
  editor.replaceRange(
    newText,
    { line: cursor.line, ch: 0 },
    { line: cursor.line, ch: lineLength }
  );
}

/**
 * Insert text at a specific position and return the end position.
 */
export function insertTextAt(editor: Editor, pos: EditorPosition, text: string): EditorPosition {
  editor.replaceRange(text, pos);
  const offset = editor.posToOffset(pos) + text.length;
  return editor.offsetToPos(offset);
}

/**
 * Check if editor has a non-empty selection.
 */
export function hasSelection(editor: Editor): boolean {
  return editor.getSelection().length > 0;
}
