// ── Stats Panel (WebviewPanel) ──
// Productivity metrics — ported from oh-my-ag stats.ts
// Auto-detects sessions, tracks metrics in .serena/metrics.json

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

function saveMetrics(metrics: Metrics): void {
    const p = getMetricsPath();
    if (!p) return;
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    metrics.lastUpdated = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(metrics, null, 2), 'utf-8');
}

// ── Git stats (ported from oh-my-ag lib/git.ts) ──

function getGitStats(cwd: string): { filesChanged: number; linesAdded: number; linesRemoved: number; recentCommits: number } {
    try {
        const diffStat = execSync('git diff --stat HEAD~10 2>/dev/null || git diff --stat', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        const lines = diffStat.trim().split('\n');
        const summaryLine = lines[lines.length - 1] || '';
        const files = parseInt((summaryLine.match(/(\d+) files? changed/) || ['', '0'])[1]);
        const added = parseInt((summaryLine.match(/(\d+) insertions?/) || ['', '0'])[1]);
        const removed = parseInt((summaryLine.match(/(\d+) deletions?/) || ['', '0'])[1]);
        const logCount = execSync('git rev-list --count HEAD~10..HEAD 2>/dev/null || echo 0', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        return { filesChanged: files, linesAdded: added, linesRemoved: removed, recentCommits: parseInt(logCount) || 0 };
    } catch { return { filesChanged: 0, linesAdded: 0, linesRemoved: 0, recentCommits: 0 }; }
}

// ── Memory stats (ported from oh-my-ag lib/memory.ts) ──

function getSessionMeta(memoriesDir: string): { id?: string; status?: string; startedAt?: string } {
    const sessionFile = path.join(memoriesDir, 'orchestrator-session.md');
    if (!fs.existsSync(sessionFile)) return {};
    try {
        const content = fs.readFileSync(sessionFile, 'utf-8');
        const id = (content.match(/## ID:\s*(.+)/i) || content.match(/session-id:\s*(.+)/i) || content.match(/(session-\d{8}-\d{6})/i) || [])[1]?.trim();
        const status = (content.match(/## Status:\s*(.+)/i) || content.match(/status:\s*(running|completed|failed|aborted|idle|pending)/i) || [])[1]?.trim().toLowerCase();
        const startedAt = (content.match(/## Started:\s*(.+)/i) || content.match(/started:\s*(.+)/i) || [])[1]?.trim();
        return { id, status, startedAt };
    } catch { return {}; }
}

function getCompletedTasksCount(memoriesDir: string): number {
    if (!fs.existsSync(memoriesDir)) return 0;
    let completed = 0;
    try {
        for (const f of fs.readdirSync(memoriesDir)) {
            if (!f.startsWith('result-') || !f.endsWith('.md')) continue;
            const content = fs.readFileSync(path.join(memoriesDir, f), 'utf-8');
            if (/status[^:]*:\s*completed/i.test(content)) completed++;
        }
        // Also count from task-board
        const tbPath = path.join(memoriesDir, 'task-board.md');
        if (fs.existsSync(tbPath)) {
            const tb = fs.readFileSync(tbPath, 'utf-8');
            const tbCompleted = (tb.match(/✅\s*completed/gi) || []).length;
            completed = Math.max(completed, tbCompleted);
        }
        // Also check orchestrator-session summary
        const sessionFile = path.join(memoriesDir, 'orchestrator-session.md');
        if (fs.existsSync(sessionFile)) {
            const content = fs.readFileSync(sessionFile, 'utf-8');
            const m = content.match(/Completed:\s*(\d+)/i);
            if (m?.[1]) completed = Math.max(completed, parseInt(m[1], 10));
        }
    } catch { }
    return completed;
}

function countSessions(memoriesDir: string): number {
    if (!fs.existsSync(memoriesDir)) return 0;
    try {
        return fs.readdirSync(memoriesDir).filter(f => /^session-.*\.md$/.test(f)).length;
    } catch { return 0; }
}

function detectSkillsFromMemories(memoriesDir: string): Record<string, number> {
    const skills: Record<string, number> = {};
    if (!fs.existsSync(memoriesDir)) return skills;
    try {
        for (const f of fs.readdirSync(memoriesDir)) {
            const m = f.match(/(?:progress|result)-([\w-]+)/);
            if (m?.[1]) skills[m[1]] = (skills[m[1]] || 0) + 1;
        }
    } catch { }
    return skills;
}

// ── Aggregate and persist metrics (like oh-my-ag stats.ts) ──

function aggregateMetrics(): { metrics: Metrics; git: ReturnType<typeof getGitStats> } {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath ?? '';
    const memoriesDir = path.join(cwd, '.serena', 'memories');

    const metrics = loadMetrics();
    const git = getGitStats(cwd);
    const detectedSkills = detectSkillsFromMemories(memoriesDir);
    const completedTasks = getCompletedTasksCount(memoriesDir);
    const sessionMeta = getSessionMeta(memoriesDir);
    const sessionCount = countSessions(memoriesDir);

    // Merge detected skills
    for (const [skill, count] of Object.entries(detectedSkills)) {
        metrics.skillsUsed[skill] = Math.max(metrics.skillsUsed[skill] || 0, count);
    }

    // Update completed tasks (max of existing and detected)
    metrics.tasksCompleted = Math.max(metrics.tasksCompleted, completedTasks);

    // Track session meta
    if (sessionMeta.id) {
        const isTerminal = ['completed', 'failed', 'aborted'].includes(sessionMeta.status || '');
        const isNew = isTerminal && (metrics.lastSessionId !== sessionMeta.id || metrics.lastSessionStatus !== sessionMeta.status);
        if (isNew && sessionMeta.startedAt) {
            const startTime = new Date(sessionMeta.startedAt).getTime();
            if (!isNaN(startTime)) {
                const duration = Math.floor((Date.now() - startTime) / 1000);
                if (duration > 0) metrics.totalSessionTime += duration;
            }
        }
        metrics.lastSessionId = sessionMeta.id;
        metrics.lastSessionStatus = sessionMeta.status;
        metrics.lastSessionStarted = sessionMeta.startedAt;
    }

    // Update session count
    metrics.sessions = Math.max(metrics.sessions, sessionCount);

    // Update git stats (accumulate)
    metrics.filesChanged = Math.max(metrics.filesChanged, git.filesChanged);
    metrics.linesAdded = Math.max(metrics.linesAdded, git.linesAdded);
    metrics.linesRemoved = Math.max(metrics.linesRemoved, git.linesRemoved);

    saveMetrics(metrics);
    return { metrics, git };
}

function getHtml(): string {
    const { metrics, git } = aggregateMetrics();
    const days = Math.max(1, Math.ceil((Date.now() - new Date(metrics.startDate).getTime()) / 86400000));

    const sortedSkills = Object.entries(metrics.skillsUsed)
        .sort(([, a], [, b]) => b - a).slice(0, 5);

    const skillRows = sortedSkills.map(([name, count], i) =>
        `<tr><td>${i + 1}</td><td>${name}</td><td>${count}</td></tr>`
    ).join('') || '<tr><td colspan="3" style="color:var(--dim)">No skill usage detected</td></tr>';

    const avgSessionTime = metrics.sessions > 0 ? Math.round(metrics.totalSessionTime / metrics.sessions) : 0;
    const avgTimeStr = avgSessionTime > 0 ? `${Math.floor(avgSessionTime / 60)}m ${avgSessionTime % 60}s` : '-';

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#1e1e2e);--surface:#24273a;--border:#363a4f;--text:var(--vscode-foreground,#cdd6f4);--dim:#6c7086;--green:#a6e3a1;--red:#f38ba8;--accent:#89b4fa}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        h1{font-size:18px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
        .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
        .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}
        .stat-value{font-size:24px;font-weight:700;margin-bottom:4px} .stat-label{font-size:11px;color:var(--dim);text-transform:uppercase}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
        .card-title{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
        table{width:100%;border-collapse:collapse} th{text-align:left;padding:6px 10px;color:var(--dim);font-size:11px;border-bottom:1px solid var(--border)}
        td{padding:8px 10px;border-bottom:1px solid rgba(54,58,79,0.5)}
        .footer{text-align:center;color:var(--dim);font-size:11px;margin-top:16px}
        .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        button{background:#89b4fa;color:#1e1e2e;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:auto}
        button:hover{background:#74c7ec}
        .header-row{display:flex;align-items:center;margin-bottom:16px}
    </style></head><body>
    <div class="header-row"><h1>📊 oh-my-ag Stats (${days} days)</h1>
        <button onclick="acquireVsCodeApi().postMessage({type:'refresh'})">↻ Refresh</button>
    </div>
    <div class="grid">
        <div class="stat-card"><div class="stat-value">${metrics.sessions}</div><div class="stat-label">Sessions</div></div>
        <div class="stat-card"><div class="stat-value">${metrics.tasksCompleted}</div><div class="stat-label">Tasks Completed</div></div>
        <div class="stat-card"><div class="stat-value">${git.recentCommits}</div><div class="stat-label">Recent Commits</div></div>
        <div class="stat-card"><div class="stat-value">${avgTimeStr}</div><div class="stat-label">Avg Session Time</div></div>
    </div>
    <div class="grid">
        <div class="stat-card"><div class="stat-value">${git.filesChanged}</div><div class="stat-label">Files Changed</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--green)">+${git.linesAdded}</div><div class="stat-label">Lines Added</div></div>
        <div class="stat-card"><div class="stat-value" style="color:var(--red)">-${git.linesRemoved}</div><div class="stat-label">Lines Removed</div></div>
        <div class="stat-card"><div class="stat-value">${Object.keys(metrics.skillsUsed).length}</div><div class="stat-label">Skills Used</div></div>
    </div>
    <div class="two-col">
        <div class="card"><div class="card-title">🏆 Top Skills Used</div><table><thead><tr><th>#</th><th>Skill</th><th>Count</th></tr></thead><tbody>${skillRows}</tbody></table></div>
        <div class="card"><div class="card-title">📋 Session Info</div>
            <div style="padding:4px 0"><strong>Last Session:</strong> ${metrics.lastSessionId || 'N/A'}</div>
            <div style="padding:4px 0"><strong>Status:</strong> ${metrics.lastSessionStatus || 'N/A'}</div>
            <div style="padding:4px 0"><strong>Total Time:</strong> ${Math.floor(metrics.totalSessionTime / 60)}m ${metrics.totalSessionTime % 60}s</div>
            <div style="padding:4px 0"><strong>Last Updated:</strong> ${new Date(metrics.lastUpdated).toLocaleString()}</div>
        </div>
    </div>
    <div class="footer">Data persisted in .serena/metrics.json</div>
    <script>const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{if(e.data.type==='update')document.location.reload()});</script>
    </body></html>`;
}

export function showStatsPanel(): void {
    if (panel) { panel.reveal(); panel.webview.html = getHtml(); return; }
    panel = vscode.window.createWebviewPanel('ohMyAg.stats', '📊 Stats', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getHtml();
    panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'refresh') panel!.webview.html = getHtml();
    });
    panel.onDidDispose(() => { panel = undefined; });
}
