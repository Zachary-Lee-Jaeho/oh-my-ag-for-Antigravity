// ── Stats Panel (WebviewPanel) ──
// Productivity metrics — ported from oh-my-ag's stats.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Metrics } from '../types';

let panel: vscode.WebviewPanel | undefined;

function getMetricsPath(): string | null {
    const ws = vscode.workspace.workspaceFolders?.[0];
    return ws ? path.join(ws.uri.fsPath, '.serena', 'metrics.json') : null;
}

function createEmptyMetrics(): Metrics {
    return { sessions: 0, skillsUsed: {}, tasksCompleted: 0, totalSessionTime: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0, lastUpdated: new Date().toISOString(), startDate: new Date().toISOString() };
}

function loadMetrics(): Metrics {
    const p = getMetricsPath();
    if (p && fs.existsSync(p)) {
        try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { /* fall through */ }
    }
    return createEmptyMetrics();
}

function getGitStats(cwd: string): { filesChanged: number; linesAdded: number; linesRemoved: number; recentCommits: number } {
    try {
        const diff = execSync('git diff --stat HEAD~10..HEAD --shortstat 2>/dev/null || echo ""', { cwd, encoding: 'utf-8' }).trim();
        const files = parseInt((diff.match(/(\d+) files? changed/) || ['', '0'])[1]);
        const added = parseInt((diff.match(/(\d+) insertions?/) || ['', '0'])[1]);
        const removed = parseInt((diff.match(/(\d+) deletions?/) || ['', '0'])[1]);
        const logCount = execSync('git rev-list --count HEAD~10..HEAD 2>/dev/null || echo 0', { cwd, encoding: 'utf-8' }).trim();
        return { filesChanged: files, linesAdded: added, linesRemoved: removed, recentCommits: parseInt(logCount) || 0 };
    } catch { return { filesChanged: 0, linesAdded: 0, linesRemoved: 0, recentCommits: 0 }; }
}

function detectSkillsFromMemories(cwd: string): Record<string, number> {
    const dir = path.join(cwd, '.serena', 'memories');
    const skills: Record<string, number> = {};
    if (!fs.existsSync(dir)) return skills;
    try {
        for (const f of fs.readdirSync(dir)) {
            const m = f.match(/(?:progress|result)-(\w+)/);
            if (m?.[1]) skills[m[1]] = (skills[m[1]] || 0) + 1;
        }
    } catch { }
    return skills;
}

function getHtml(): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath ?? '';
    const metrics = loadMetrics();
    const git = getGitStats(cwd);
    const detectedSkills = detectSkillsFromMemories(cwd);

    const days = Math.max(1, Math.ceil((Date.now() - new Date(metrics.startDate).getTime()) / 86400000));
    const sortedSkills = Object.entries({ ...metrics.skillsUsed, ...detectedSkills })
        .sort(([, a], [, b]) => b - a).slice(0, 5);

    const skillRows = sortedSkills.map(([name, count], i) =>
        `<tr><td>${i + 1}</td><td>${name}</td><td>${count}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="color:var(--dim)">No skill usage detected</td></tr>';

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#1e1e2e);--surface:#24273a;--border:#363a4f;--text:var(--vscode-foreground,#cdd6f4);--dim:#6c7086;--green:#a6e3a1;--red:#f38ba8}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        h1{font-size:18px;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
        .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
        .stat-value{font-size:24px;font-weight:700;margin-bottom:4px} .stat-label{font-size:11px;color:var(--dim);text-transform:uppercase}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
        .card-title{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
        table{width:100%;border-collapse:collapse} th{text-align:left;padding:6px 10px;color:var(--dim);font-size:11px;border-bottom:1px solid var(--border)}
        td{padding:8px 10px;border-bottom:1px solid rgba(54,58,79,0.5)}
        .footer{text-align:center;color:var(--dim);font-size:11px;margin-top:16px}
    </style></head><body>
    <h1>📊 oh-my-ag Stats (${days} days)</h1>
    <div class="grid">
        <div class="stat-card"><div class="stat-value">${metrics.sessions}</div><div class="stat-label">Sessions</div></div>
        <div class="stat-card"><div class="stat-value">${metrics.tasksCompleted}</div><div class="stat-label">Tasks Completed</div></div>
        <div class="stat-card"><div class="stat-value">${git.recentCommits}</div><div class="stat-label">Recent Commits</div></div>
        <div class="stat-card"><div class="stat-value">${git.filesChanged}</div><div class="stat-label">Files Changed</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--green)">+${git.linesAdded}</div><div class="stat-label">Lines Added</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--red)">-${git.linesRemoved}</div><div class="stat-label">Lines Removed</div></div>
    </div>
    <div class="card"><div class="card-title">🏆 Top Skills Used</div><table><thead><tr><th>#</th><th>Skill</th><th>Count</th></tr></thead><tbody>${skillRows}</tbody></table></div>
    <div class="footer">Data stored in .serena/metrics.json</div>
    </body></html>`;
}

export function showStatsPanel(): void {
    if (panel) { panel.reveal(); panel.webview.html = getHtml(); return; }
    panel = vscode.window.createWebviewPanel('ohMyAg.stats', '📊 Stats', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getHtml();
    panel.onDidDispose(() => { panel = undefined; });
}
