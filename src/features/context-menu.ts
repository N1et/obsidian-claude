import { Menu, Editor, MarkdownView } from 'obsidian';
import type ClaudePlugin from '../main';
import { executeTransform } from './text-transform';
import { TransformType } from '../prompt-templates';

interface ContextMenuItem {
  title: string;
  type: TransformType;
}

const MENU_ITEMS: ContextMenuItem[] = [
  { title: 'Improve Writing', type: 'improve' },
  { title: 'Fix Grammar', type: 'grammar' },
  { title: 'Make Shorter', type: 'shorter' },
  { title: 'Make Longer', type: 'longer' },
  { title: 'Summarize', type: 'summarize' },
  { title: 'Explain Simply', type: 'explain' },
  { title: 'Continue Writing', type: 'continue' },
];

export function registerContextMenu(plugin: ClaudePlugin) {
  plugin.registerEvent(
    plugin.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
      const selection = editor.getSelection();
      if (!selection) return;

      menu.addSeparator();

      for (const item of MENU_ITEMS) {
        menu.addItem((menuItem) => {
          menuItem
            .setTitle(`Claude: ${item.title}`)
            .setIcon('sparkles')
            .onClick(() => {
              executeTransform(plugin, editor, item.type);
            });
        });
      }
    })
  );
}
