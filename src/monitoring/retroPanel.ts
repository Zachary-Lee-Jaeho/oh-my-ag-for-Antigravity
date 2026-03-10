// ── Retro Panel (WebviewPanel) ──
// Session retrospective — ported from oh-my-ag's retro.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Retrospective } from '../types';

let panel: vscode.WebviewPanel | undefined;

function getRecentCommits(cwd: string, count = 20): string[] {
    try {
        return execSync(`git log --oneline -${count} 2>/dev/null || echo ""`, { cwd, encoding: 'utf-8' })
            .trim().split('\n').filter(Boolean);
    } catch { return []; }
}

function getCommitTypes(cwd: string): Record<string, number> {
    const types: Record<string, number> = {};
    try {
        const logs = execSync('git log --oneline -50 2>/dev/null || echo ""', { cwd, encoding: 'utf-8' }).trim().split('\n');
        for (const log of logs) {
            const match = log.match(/^\w+ (\w+)(?:\([^)]*\))?:/);
            if (match?.[1]) types[match[1]] = (types[match[1]] || 0) + 1;
        }
    } catch { }
    return types;
}

function getSessionSummary(cwd: string): { summary: string; learnings: string[]; nextSteps: string[] } {
    const memoriesDir = path.join(cwd, '.serena', 'memories');
    const summary: string[] = [];
    const learnings: string[] = [];
    const nextSteps: string[] = [];

    if (!fs.existsSync(memoriesDir)) return { summary: 'No session data found.', learnings: [], nextSteps: [] };

    try {
        const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md')).sort();
        for (const f of files) {
            const content = fs.readFileSync(path.join(memoriesDir, f), 'utf-8');
            // Extract key information
            if (f.startsWith('result-')) {
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('---'));
                if (lines.length > 0) summary.push(`${f.replace('.md', '')}: ${lines.slice(0, 2).join(' ').substring(0, 100)}`);
            }
            // Extract learnings
            const learnSection = content.match(/## (?:Learnings?|Key Takeaways?|Lessons)\n([\s\S]*?)(?=\n##|\n$)/i);
            if (learnSection?.[1]) {
                learnings.push(...learnSection[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().replace(/^-\s*/, '')));
            }
            // Extract next steps
            const nextSection = content.match(/## (?:Next Steps?|TODO|Action Items)\n([\s\S]*?)(?=\n##|\n$)/i);
            if (nextSection?.[1]) {
                nextSteps.push(...nextSection[1].split('\n').filter(l => l.trim().startsWith('-')).map(l => l.trim().replace(/^-\s*/, '')));
            }
        }
    } catch { }

    return {
        summary: summary.length > 0 ? summary.join('\n') : 'No completed agent results found.',
        learnings: [...new Set(learnings)].slice(0, 10),
        nextSteps: [...new Set(nextSteps)].slice(0, 10),
    };
}

function loadRetrospectives(cwd: string): Retrospective[] {
    const retroPath = path.join(cwd, '.serena', 'retrospectives.json');
    if (!fs.existsSync(retroPath)) return [];
    try { return JSON.parse(fs.readFileSync(retroPath, 'utf-8')); } catch { return []; }
}

function getHtml(): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath ?? '';
    const commits = getRecentCommits(cwd);
    const commitTypes = getCommitTypes(cwd);
    const session = getSessionSummary(cwd);
    const pastRetros = loadRetrospectives(cwd);

    const commitList = commits.slice(0, 10).map(c => `<li>${c}</li>`).join('') || '<li style="color:var(--dim)">No commits found</li>';
    const typesList = Object.entries(commitTypes).sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `<span class="type-badge">${type}: ${count}</span>`).join(' ') || '<span style="color:var(--dim)">No commit types detected</span>';

    const learningsList = session.learnings.map(l => `<li>💡 ${l}</li>`).join('') || '<li style="color:var(--dim)">No learnings extracted</li>';
    const nextStepsList = session.nextSteps.map(s => `<li>→ ${s}</li>`).join('') || '<li style="color:var(--dim)">No next steps found</li>';
    const pastRetrosList = pastRetros.slice(0, 5).map(r => `<li><strong>${r.date}</strong>: ${r.summary.substring(0, 80)}</li>`).join('') || '<li style="color:var(--dim)">No past retrospectives</li>';

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#1e1e2e);--surface:#24273a;--border:#363a4f;--text:var(--vscode-foreground,#cdd6f4);--dim:#6c7086;--accent:#89b4fa}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        h1{font-size:18px;margin-bottom:16px} h2{font-size:14px;margin-bottom:8px;color:var(--accent)}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
        ul{list-style:none;padding:0} li{padding:4px 0;border-bottom:1px solid rgba(54,58,79,0.3)} li:last-child{border-bottom:none}
        .type-badge{background:#313244;padding:2px 8px;border-radius:4px;font-size:11px;margin:2px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    </style></head><body>
    <h1>📝 Session Retrospective</h1>
    <div class="card"><h2>📋 Recent Commits</h2><div style="margin-bottom:8px">${typesList}</div><ul>${commitList}</ul></div>
    <div class="grid">
        <div class="card"><h2>💡 Key Learnings</h2><ul>${learningsList}</ul></div>
        <div class="card"><h2>→ Next Steps</h2><ul>${nextStepsList}</ul></div>
    </div>
    <div class="card"><h2>📖 Session Summary</h2><pre style="white-space:pre-wrap;color:var(--dim);font-size:12px">${session.summary}</pre></div>
    <div class="card"><h2>🕰️ Past Retrospectives</h2><ul>${pastRetrosList}</ul></div>
    </body></html>`;
}

export function showRetroPanel(): void {
    if (panel) { panel.reveal(); panel.webview.html = getHtml(); return; }
    panel = vscode.window.createWebviewPanel('ohMyAg.retro', '📝 Retro', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getHtml();
    panel.onDidDispose(() => { panel = undefined; });
}
