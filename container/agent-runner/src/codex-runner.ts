import { spawn } from 'child_process';

export async function runCodex(prompt: string, opts?: { timeoutMs?: number }): Promise<{ text: string }>{
  const timeoutMs = opts?.timeoutMs ?? 300000;

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', ['--full-auto', 'exec', prompt], {
      cwd: process.env.NANOCLAW_GROUP_DIR || process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Codex timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Codex exited with code ${code}: ${stderr.trim().slice(-500)}`));
        return;
      }
      const lines = stdout.split('\n').map(l => l.trimEnd());
      let lastCodexIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === 'codex') lastCodexIdx = i;
      }
      let text = '';
      if (lastCodexIdx !== -1) {
        const tail = lines.slice(lastCodexIdx + 1).map(l => l.trim()).filter(Boolean);
        text = tail[tail.length - 1] || '';
      }
      if (!text) {
        for (let i = lines.length - 1; i >= 0; i--) {
          const l = lines[i].trim();
          if (!l) continue;
          if (l === 'tokens used') continue;
          text = l;
          break;
        }
      }

      if (!text) {
        reject(new Error(`Codex returned empty output. Stderr: ${stderr.trim().slice(-500)}`));
        return;
      }
      resolve({ text });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
