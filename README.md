# Obsidian Claude Copilot

A native Claude AI integration for Obsidian, powered by the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). No API key needed — just install the CLI and start chatting.

![Chat panel with vault-aware context](images/Pasted%20image%2020260219012419.png)

## Features

### Chat Panel
Open a side panel to have a full conversation with Claude. It automatically includes your current note as context and can read, create, edit, append, delete, and rename notes directly in your vault.

- **Ask / Edit modes** — toggle between asking questions and letting Claude auto-apply changes to your notes.
- **Context chips** — the active note is tracked automatically. Pin additional notes with the **+** button so Claude can reference multiple files at once.
- **Vault awareness** — Claude sees your entire file tree and can request to read any note it needs before acting.

### Text Transforms (right-click menu)

Select text, right-click, and pick a transform:

<img width="2630" height="1566" alt="image" src="https://github.com/user-attachments/assets/72ee7aec-1bd5-467f-99d4-34c7d5fed20d" />

- **Improve Writing** — better clarity and readability
- **Fix Grammar** — correct spelling and punctuation
- **Make Shorter / Longer** — condense or expand text
- **Summarize** — generate a concise summary
- **Explain Simply** — rewrite in plain language
- **Continue Writing** — keep going in the same style

Also available as command palette commands, plus **Translate** (10 languages) and **Custom Prompt** (free-form instruction).

### Inline `/ai` Commands

Type `/ai` followed by a prompt directly in your note. A suggestion popup appears with quick actions (continue writing, summarize, generate outline) or lets you run any custom prompt. The result streams right into the editor.

<img width="2086" height="1120" alt="image" src="https://github.com/user-attachments/assets/10fde04c-182a-46c2-8b84-81d8cd62da03" />
<img width="1952" height="948" alt="image" src="https://github.com/user-attachments/assets/72deda7a-8a4c-4773-8795-942a91795746" />


## Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- Obsidian v1.0.0+

## Installation

1. Copy the plugin folder (containing `main.js`, `manifest.json`, and `styles.css`) into your vault at:
   ```
   <your-vault>/.obsidian/plugins/obsidian-claude/
   ```
2. Open Obsidian, go to **Settings > Community plugins**, disable **Restricted mode**.
3. Enable **Claude AI** in the plugin list.

## Settings

| Setting | Description |
|---|---|
| **Claude CLI path** | Path to the `claude` executable (default: `claude` from PATH) |
| **Default model** | Model to use via `--model` flag (leave empty for default) |
| **Include note context** | Send the active note content with every prompt |
| **Context max characters** | Limit how much note content is sent (default: 8000) |
| **Test connection** | Quick check that the CLI is reachable |

## License

MIT
