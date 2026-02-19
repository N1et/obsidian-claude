import { App, TFile, TFolder, Notice, normalizePath } from 'obsidian';

export interface VaultAction {
  action: 'create' | 'edit' | 'append' | 'delete' | 'rename';
  path: string;
  content?: string;
  newPath?: string;
}

/**
 * Parse vault actions from Claude's response.
 * Uses XML-like tags to avoid conflicts with markdown code blocks:
 *
 * <vault-action action="create" path="folder/note.md">
 * content here, can include ```code blocks``` safely
 * </vault-action>
 *
 * <vault-action action="edit" path="existing.md">
 * full new content
 * </vault-action>
 *
 * <vault-action action="append" path="note.md">
 * content to append
 * </vault-action>
 *
 * <vault-action action="delete" path="note.md"></vault-action>
 *
 * <vault-action action="rename" path="old.md" to="new.md"></vault-action>
 */
/**
 * Parse <read-file path="..."/> requests from Claude's response.
 * Returns the paths requested and the text with those tags removed.
 */
export function parseReadFileRequests(text: string): { cleanText: string; paths: string[] } {
  const paths: string[] = [];
  const readRegex = /<read-file\s+path="([^"]+)"\s*\/?\s*>/g;

  const cleanText = text.replace(readRegex, (_, path) => {
    paths.push(normalizePath(path));
    return '';
  }).trim();

  return { cleanText, paths };
}

export function parseVaultActions(text: string): { cleanText: string; actions: VaultAction[] } {
  const actions: VaultAction[] = [];
  const actionRegex = /<vault-action\s+action="(create|edit|append|delete|rename)"\s+path="([^"]+)"(?:\s+to="([^"]*)")?\s*>([\s\S]*?)<\/vault-action>/g;

  const cleanText = text.replace(actionRegex, (_, action, path, newPath, content) => {
    const vaultAction: VaultAction = {
      action: action as VaultAction['action'],
      path: normalizePath(path),
      content: content?.trim() || undefined,
      newPath: newPath ? normalizePath(newPath) : undefined,
    };
    actions.push(vaultAction);
    return '';
  }).trim();

  return { cleanText, actions };
}

/**
 * Find a file by exact path first, then fallback to searching by basename.
 */
function findFile(app: App, filePath: string): TFile | null {
  const { vault } = app;

  const exact = vault.getAbstractFileByPath(filePath);
  if (exact instanceof TFile) return exact;

  if (!filePath.endsWith('.md')) {
    const withMd = vault.getAbstractFileByPath(filePath + '.md');
    if (withMd instanceof TFile) return withMd;
  }

  const targetName = filePath.split('/').pop()?.replace(/\.md$/, '').toLowerCase() || '';
  const allFiles = vault.getFiles();
  const match = allFiles.find(f => f.basename.toLowerCase() === targetName);
  return match || null;
}

export async function executeVaultAction(app: App, action: VaultAction): Promise<string> {
  const { vault } = app;

  switch (action.action) {
    case 'create': {
      const existing = findFile(app, action.path);
      if (existing) {
        return `File already exists: ${existing.path}`;
      }
      const folder = action.path.substring(0, action.path.lastIndexOf('/'));
      if (folder) {
        const folderExists = vault.getAbstractFileByPath(folder);
        if (!folderExists) {
          await vault.createFolder(folder);
        }
      }
      await vault.create(action.path, action.content || '');
      return `Created: ${action.path}`;
    }

    case 'edit': {
      const file = findFile(app, action.path);
      if (!file) {
        return `File not found: ${action.path}`;
      }
      await vault.modify(file, action.content || '');
      return `Edited: ${file.path}`;
    }

    case 'append': {
      const file = findFile(app, action.path);
      if (!file) {
        return `File not found: ${action.path}`;
      }
      await vault.append(file, '\n' + (action.content || ''));
      return `Appended to: ${file.path}`;
    }

    case 'delete': {
      const file = findFile(app, action.path);
      if (!file) {
        return `File not found: ${action.path}`;
      }
      await vault.trash(file, false);
      return `Deleted: ${file.path}`;
    }

    case 'rename': {
      const file = findFile(app, action.path);
      if (!file) {
        return `File not found: ${action.path}`;
      }
      if (!action.newPath) {
        return `No new path specified for rename`;
      }
      await vault.rename(file, action.newPath);
      return `Renamed: ${file.path} -> ${action.newPath}`;
    }

    default:
      return `Unknown action: ${action.action}`;
  }
}

export function getActionLabel(action: VaultAction): string {
  switch (action.action) {
    case 'create': return `Create "${action.path}"`;
    case 'edit': return `Edit "${action.path}"`;
    case 'append': return `Append to "${action.path}"`;
    case 'delete': return `Delete "${action.path}"`;
    case 'rename': return `Rename "${action.path}" to "${action.newPath}"`;
    default: return `Unknown action`;
  }
}

export function getActionIcon(action: VaultAction): string {
  switch (action.action) {
    case 'create': return '+';
    case 'edit': return '\u270E';
    case 'append': return '\u2795';
    case 'delete': return '\u2716';
    case 'rename': return '\u2192';
    default: return '?';
  }
}

export const VAULT_SYSTEM_PROMPT = `You are an AI assistant integrated into Obsidian, a note-taking app. You have full access to the user's vault: you can see all files and their paths, read the currently open note, and perform actions on any file.

The vault file structure is provided below. Use the EXACT paths shown there when referencing existing files.

When the user asks to modify, create, delete, or rename notes, you MUST use vault action tags. These use XML-like syntax that does NOT conflict with markdown code blocks.

Available actions:

1. CREATE a new note:
<vault-action action="create" path="folder/note-name.md">
Content of the new note in Markdown.
Can include \`\`\`code blocks\`\`\` and any markdown safely.
</vault-action>

2. EDIT (overwrite) an existing note:
<vault-action action="edit" path="folder/existing-note.md">
Complete new content of the note.
</vault-action>

3. APPEND to an existing note:
<vault-action action="append" path="folder/existing-note.md">
Content to add at the end.
</vault-action>

4. DELETE a note:
<vault-action action="delete" path="folder/note.md"></vault-action>

5. RENAME/MOVE a note:
<vault-action action="rename" path="folder/old.md" to="folder/new.md"></vault-action>

6. READ notes (to see their content before acting):
<read-file path="folder/note.md"/>

You can request multiple files at once:
<read-file path="folder/note1.md"/>
<read-file path="folder/note2.md"/>

When you use <read-file> tags, the system will automatically fetch the file contents and send them back to you. You will then receive a follow-up message with the contents so you can continue your task.

CRITICAL RULES:
- ALWAYS use the exact file paths from the vault structure provided. Never guess paths.
- Use <vault-action> tags, NOT code blocks, for vault operations.
- Use <read-file> tags when you need to read notes that are NOT already provided as context. You can see the vault file structure above — use it to know which files exist.
- When editing, provide the COMPLETE new content of the note inside the tags.
- The content inside <vault-action> tags can safely contain code blocks, backticks, and any markdown.
- You can include multiple vault-action tags in one response.
- If you need to read files first before performing an action, use <read-file> tags FIRST and wait for the contents. Do NOT guess file contents.
- Briefly explain what you are doing outside the tags.
`;
