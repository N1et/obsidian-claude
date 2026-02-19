import { spawn, ChildProcess } from 'child_process';

const activeProcesses: Set<ChildProcess> = new Set();

export interface RunOptions {
  cliPath?: string;
  prompt: string;
  model?: string;
  onData?: (chunk: string) => void;
  onDone?: (fullText: string) => void;
  onError?: (err: Error) => void;
}

export function runClaude(options: RunOptions): ChildProcess {
  const cli = options.cliPath || 'claude';
  const args = ['-p', '--output-format', 'text'];

  if (options.model) {
    args.push('--model', options.model);
  }

  // Clean env: remove CLAUDECODE to avoid "nested session" error
  const cleanEnv = { ...process.env };
  delete cleanEnv['CLAUDECODE'];

  const proc = spawn(cli, args, {
    windowsHide: true,
    env: cleanEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  activeProcesses.add(proc);

  let output = '';
  let errorOutput = '';

  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    options.onData?.(text);
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    errorOutput += chunk.toString();
  });

  proc.on('close', (code) => {
    activeProcesses.delete(proc);
    if (code !== 0 && code !== null && output === '') {
      options.onError?.(new Error(
        errorOutput.trim() || `Claude exited with code ${code}`
      ));
    } else {
      options.onDone?.(output);
    }
  });

  proc.on('error', (err) => {
    activeProcesses.delete(proc);
    options.onError?.(new Error(
      `Failed to start Claude CLI: ${err.message}. Check the CLI path in settings.`
    ));
  });

  // Send prompt via stdin to avoid Windows argument length limits
  proc.stdin?.write(options.prompt);
  proc.stdin?.end();

  return proc;
}

export function killProcess(proc: ChildProcess): void {
  if (proc && !proc.killed) {
    proc.kill();
    activeProcesses.delete(proc);
  }
}

export function killAllProcesses(): void {
  for (const proc of activeProcesses) {
    if (!proc.killed) {
      proc.kill();
    }
  }
  activeProcesses.clear();
}
