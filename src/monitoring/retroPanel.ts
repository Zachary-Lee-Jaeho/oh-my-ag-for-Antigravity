// ── Retro Panel (WebviewPanel) ──
// Session retrospective — ported from oh-my-ag retro.ts
// Auto-generates from git, agent activities, and .serena/retrospectives/*.json

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { Retrospective } from '../types';

let panel: vscode.WebviewPanel | undefined;

// ── Git helpers (ported from oh-my-ag lib/git.ts) ──

function getRecentCommits(cwd: string, count = 20): string[] {
    try {
        return execSync(`git log --oneline -${count} 2>/dev/null || echo ""`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
            .trim().split('\n').filter(Boolean);
    } catch { return []; }
}

function getCommitMessages(cwd: string, limit = 10): string[] {
    try {
        return execSync(`git log --format="%s" -${limit} 2>/dev/null`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
            .trim().split('\n').filter(Boolean);
    } catch { return []; }
}

function getCommitTypes(commits: string[]): Record<string, number> {
    const types: Record<string, number> = {};
    for (const commit of commits) {
        const match = commit.match(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf)(\(.+\))?:/);
        if (match?.[1]) types[match[1]] = (types[match[1]] || 0) + 1;
    }
    return types;
}

function getGitStats(cwd: string): { filesChanged: number; linesAdded: number; linesRemoved: number } {
    try {
        const diffStat = execSync('git diff --stat HEAD~10 2>/dev/null || git diff --stat', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
        const lines = diffStat.trim().split('\n');
        const summaryLine = lines[lines.length - 1] || '';
        return {
            filesChanged: parseInt((summaryLine.match(/(\d+) files? changed/) || ['', '0'])[1]),
            linesAdded: parseInt((summaryLine.match(/(\d+) insertions?/) || ['', '0'])[1]),
            linesRemoved: parseInt((summaryLine.match(/(\d+) deletions?/) || ['', '0'])[1]),
        };
    } catch { return { filesChanged: 0, linesAdded: 0, linesRemoved: 0 }; }
}

function getRecentChangedFiles(cwd: string): string[] {
    try {
        return execSync('git diff --name-only HEAD~5 2>/dev/null || git diff --name-only', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] })
            .trim().split('\n').filter(Boolean).slice(0, 10);
    } catch { return []; }
}

// ── Memory helpers (ported from oh-my-ag lib/memory.ts) ──

interface AgentActivity { agent: string; type: 'progress' | 'result'; content: string; }

function getAgentActivities(memoriesDir: string): AgentActivity[] {
    if (!fs.existsSync(memoriesDir)) return [];
    const activities: AgentActivity[] = [];
    try {
        for (const f of fs.readdirSync(memoriesDir)) {
            if (!f.endsWith('.md')) continue;
            const pm = f.match(/^progress-(\w+)\.md$/);
            const rm = f.match(/^result-(\w+)\.md$/);
            if (pm?.[1] || rm?.[1]) {
                const content = fs.readFileSync(path.join(memoriesDir, f), 'utf-8').slice(0, 500);
                activities.push({ agent: (pm?.[1] || rm?.[1])!, type: pm ? 'progress' : 'result', content });
            }
        }
    } catch { }
    return activities;
}

function extractKeyLearnings(activities: AgentActivity[]): string[] {
    const learnings: string[] = [];
    for (const a of activities) {
        const c = a.content.toLowerCase();
        if (c.includes('error') || c.includes('fail')) learnings.push(`${a.agent}: Error handling improved`);
        if (c.includes('refactor')) learnings.push(`${a.agent}: Code structure refactored`);
        if (c.includes('test')) learnings.push(`${a.agent}: Test coverage added`);
        if (c.includes('performance') || c.includes('optimize')) learnings.push(`${a.agent}: Performance optimized`);
    }
    return [...new Set(learnings)].slice(0, 5);
}

function getInProgressTasks(memoriesDir: string): string[] {
    const tasks: string[] = [];
    if (!fs.existsSync(memoriesDir)) return tasks;
    try {
        for (const f of fs.readdirSync(memoriesDir)) {
            if (!f.startsWith('progress-')) continue;
            const content = fs.readFileSync(path.join(memoriesDir, f), 'utf-8');
            const m = content.match(/current[:\s]+(.+)/i) || content.match(/working on[:\s]+(.+)/i);
            if (m?.[1]) tasks.push(m[1].trim());
        }
    } catch { }
    return tasks;
}

// ── Retrospective storage (uses .serena/retrospectives/*.json like original) ──

function getRetroDir(cwd: string): string {
    return path.join(cwd, '.serena', 'retrospectives');
}

function loadRetrospectives(cwd: string): Retrospective[] {
    const retroDir = getRetroDir(cwd);
    if (!fs.existsSync(retroDir)) return [];
    try {
        return fs.readdirSync(retroDir)
            .filter(f => f.endsWith('.json')).sort().reverse().slice(0, 10)
            .map(f => JSON.parse(fs.readFileSync(path.join(retroDir, f), 'utf-8')));
    } catch { return []; }
}

function saveRetrospective(cwd: string, retro: Retrospective): void {
    const retroDir = getRetroDir(cwd);
    if (!fs.existsSync(retroDir)) fs.mkdirSync(retroDir, { recursive: true });
    const filename = `${retro.date.replace(/[:.]/g, '-')}_${retro.id}.json`;
    fs.writeFileSync(path.join(retroDir, filename), JSON.stringify(retro, null, 2), 'utf-8');
}

// ── Auto-generate retrospective (ported from oh-my-ag retro.ts) ──

function generateAutoSummary(cwd: string): { summary: string; learnings: string[]; nextSteps: string[]; changedFiles: string[] } {
    const commits = getCommitMessages(cwd);
    const commitTypes = getCommitTypes(commits);
    const stats = getGitStats(cwd);
    const memoriesDir = path.join(cwd, '.serena', 'memories');
    const activities = getAgentActivities(memoriesDir);
    const agents = [...new Set(activities.map(a => a.agent))];

    const typeDescriptions: Record<string, string> = {
        feat: 'Feature development', fix: 'Bug fixes and improvements', refactor: 'Code refactoring',
        docs: 'Documentation updates', test: 'Testing improvements', chore: 'Maintenance tasks',
        build: 'Build system updates', perf: 'Performance improvements',
    };

    const mainType = Object.entries(commitTypes).sort(([, a], [, b]) => b - a)[0];
    let summary = mainType ? (typeDescriptions[mainType[0]] || 'Development session') : 'Development session';
    if (stats.filesChanged > 0) summary += ` (${stats.filesChanged} files, +${stats.linesAdded}/-${stats.linesRemoved})`;
    if (agents.length > 0) summary += ` with ${agents.join(', ')}`;

    let learnings = extractKeyLearnings(activities);
    if (commits.length > 0 && learnings.length === 0) {
        if (commitTypes.refactor || commitTypes.perf) learnings.push('Code quality and performance improvements');
        if (commitTypes.test) learnings.push('Enhanced test coverage');
        if (commitTypes.fix) learnings.push('Issue resolution and stability improvements');
    }

    const nextSteps = getInProgressTasks(memoriesDir);
    if (commits.length > 0) {
        const lastCommit = commits[0]?.toLowerCase() || '';
        if (lastCommit.includes('wip') || lastCommit.includes('todo')) nextSteps.push('Complete work-in-progress items');
    }
    if (nextSteps.length === 0) nextSteps.push('Continue development', 'Review and test changes');

    return { summary, learnings: learnings.slice(0, 5), nextSteps: nextSteps.slice(0, 5), changedFiles: getRecentChangedFiles(cwd) };
}

// ── HTML rendering ──

function getHtml(): string {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath ?? '';
    const commits = getRecentCommits(cwd);
    const commitTypes = getCommitTypes(commits.map(c => c.replace(/^\w+\s/, '')));
    const pastRetros = loadRetrospectives(cwd);
    const { summary, learnings, nextSteps, changedFiles } = generateAutoSummary(cwd);

    const commitList = commits.slice(0, 10).map(c => `<li>${c}</li>`).join('') || '<li style="color:var(--dim)">No commits found</li>';
    const typesList = Object.entries(commitTypes).sort(([, a], [, b]) => b - a)
        .map(([type, count]) => `<span class="type-badge">${type}: ${count}</span>`).join(' ') || '<span style="color:var(--dim)">No commit types detected</span>';

    const learningsList = learnings.map(l => `<li>💡 ${l}</li>`).join('') || '<li style="color:var(--dim)">No learnings extracted</li>';
    const nextStepsList = nextSteps.map(s => `<li>→ ${s}</li>`).join('') || '<li style="color:var(--dim)">No next steps found</li>';
    const changedFilesList = changedFiles.map(f => `<li><code>${f}</code></li>`).join('') || '<li style="color:var(--dim)">No changed files</li>';

    const pastRetrosList = pastRetros.slice(0, 5).map(r =>
        `<li><strong>${r.date.split('T')[0]}</strong>: ${r.summary.substring(0, 80)}${r.summary.length > 80 ? '...' : ''}
         <div style="font-size:11px;color:var(--dim);margin-top:2px">${r.keyLearnings?.slice(0, 2).map(l => `• ${l}`).join(' ') || ''}</div></li>`
    ).join('') || '<li style="color:var(--dim)">No past retrospectives</li>';

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#1e1e2e);--surface:#24273a;--border:#363a4f;--text:var(--vscode-foreground,#cdd6f4);--dim:#6c7086;--accent:#89b4fa;--green:#a6e3a1}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        h1{font-size:18px;margin-bottom:16px;display:flex;align-items:center;gap:8px} h2{font-size:14px;margin-bottom:8px;color:var(--accent)}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
        ul{list-style:none;padding:0} li{padding:4px 0;border-bottom:1px solid rgba(54,58,79,0.3)} li:last-child{border-bottom:none}
        .type-badge{background:#313244;padding:2px 8px;border-radius:4px;font-size:11px;margin:2px}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .auto-summary{background:#1e3a5f;border:1px solid #2d5b8a;border-radius:8px;padding:16px;margin-bottom:16px}
        .auto-summary h2{color:#89b4fa}
        button{background:#89b4fa;color:#1e1e2e;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px}
        button:hover{background:#74c7ec}
        .save-btn{background:#a6e3a1;margin-left:8px}
        .header-row{display:flex;align-items:center;margin-bottom:16px;gap:8px}
        code{background:#313244;padding:1px 4px;border-radius:3px;font-size:12px}
    </style></head><body>
    <div class="header-row"><h1>📝 Session Retrospective</h1>
        <button onclick="vscode.postMessage({type:'refresh'})">↻ Refresh</button>
        <button class="save-btn" onclick="vscode.postMessage({type:'save'})">💾 Save Retro</button>
    </div>
    <div class="auto-summary"><h2>🤖 Auto-Generated Summary</h2><p style="margin-top:8px">${summary}</p></div>
    <div class="grid">
        <div class="card"><h2>💡 Key Learnings</h2><ul>${learningsList}</ul></div>
        <div class="card"><h2>→ Next Steps</h2><ul>${nextStepsList}</ul></div>
    </div>
    <div class="card"><h2>📋 Recent Commits</h2><div style="margin-bottom:8px">${typesList}</div><ul>${commitList}</ul></div>
    <div class="grid">
        <div class="card"><h2>📁 Changed Files</h2><ul>${changedFilesList}</ul></div>
        <div class="card"><h2>🕰️ Past Retrospectives (${pastRetros.length})</h2><ul>${pastRetrosList}</ul></div>
    </div>
    <script>const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{if(e.data.type==='update')document.location.reload()});</script>
    </body></html>`;
}

export function showRetroPanel(): void {
    const ws = vscode.workspace.workspaceFolders?.[0];

    if (panel) { panel.reveal(); panel.webview.html = getHtml(); return; }
    panel = vscode.window.createWebviewPanel('ohMyAg.retro', '📝 Retro', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getHtml();

    panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'refresh') {
            panel!.webview.html = getHtml();
        }
        if (msg.type === 'save' && ws) {
            const cwd = ws.uri.fsPath;
            const { summary, learnings, nextSteps, changedFiles } = generateAutoSummary(cwd);
            const retro: Retrospective = {
                id: Math.random().toString(36).slice(2, 8),
                date: new Date().toISOString(),
                summary,
                keyLearnings: learnings,
                filesChanged: changedFiles,
                nextSteps,
            };
            saveRetrospective(cwd, retro);
            vscode.window.showInformationMessage('✅ Retrospective saved to .serena/retrospectives/');
            panel!.webview.html = getHtml();
        }
    });

    panel.onDidDispose(() => { panel = undefined; });
}
