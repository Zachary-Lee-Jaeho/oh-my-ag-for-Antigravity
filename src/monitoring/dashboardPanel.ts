// ── Dashboard Panel (WebviewPanel) ──
// Real-time Serena Memory monitoring — ported from oh-my-ag's dashboard.ts
// Uses FileSystemWatcher instead of chokidar + WebSocket.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentInfo, SessionInfo, DashboardState } from '../types';

let panel: vscode.WebviewPanel | undefined;
let watcher: vscode.FileSystemWatcher | undefined;

function readFileSafe(filePath: string): string {
    try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function getMemoriesDir(): string | null {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return null;
    const dir = path.join(ws.uri.fsPath, '.serena', 'memories');
    return fs.existsSync(dir) ? dir : null;
}

function parseSessionInfo(memoriesDir: string): SessionInfo {
    try {
        const files = fs.readdirSync(memoriesDir);
        let sessionFile: string | null = null;
        if (files.includes('orchestrator-session.md')) {
            sessionFile = path.join(memoriesDir, 'orchestrator-session.md');
        } else {
            const sf = files.filter(f => /^session-.*\.md$/.test(f))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(memoriesDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            if (sf.length > 0 && sf[0]) sessionFile = path.join(memoriesDir, sf[0].name);
        }
        if (!sessionFile) return { id: 'N/A', status: 'UNKNOWN' };

        const content = readFileSafe(sessionFile);
        const id = (content.match(/session-id:\s*(.+)/i) || content.match(/# Session:\s*(.+)/i) || [])[1]
            || content.match(/(session-\d{8}-\d{6})/)?.[1] || path.basename(sessionFile, '.md') || 'N/A';
        let status = 'UNKNOWN';
        if (/IN PROGRESS|RUNNING/i.test(content)) status = 'RUNNING';
        else if (/COMPLETED|DONE/i.test(content)) status = 'COMPLETED';
        else if (/FAILED|ERROR/i.test(content)) status = 'FAILED';
        return { id: id.trim(), status };
    } catch { return { id: 'N/A', status: 'UNKNOWN' }; }
}

function parseTaskBoard(memoriesDir: string): AgentInfo[] {
    const content = readFileSafe(path.join(memoriesDir, 'task-board.md'));
    if (!content) return [];
    const agents: AgentInfo[] = [];
    for (const line of content.split('\n')) {
        if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue;
        const cols = line.split('|').map(c => c.trim()).filter(Boolean);
        if (cols.length < 2 || !cols[0] || /^agent$/i.test(cols[0])) continue;
        agents.push({ agent: cols[0], status: cols[1] || 'pending', task: cols[2] || '', turn: null });
    }
    return agents;
}

function getAgentTurn(memoriesDir: string, agent: string): number | null {
    try {
        const files = fs.readdirSync(memoriesDir)
            .filter(f => f.startsWith(`progress-${agent}`) && f.endsWith('.md'))
            .sort().reverse();
        if (files.length === 0) return null;
        const content = files[0] ? readFileSafe(path.join(memoriesDir, files[0])) : '';
        const match = content.match(/turn[:\s]*(\d+)/i);
        return match?.[1] ? parseInt(match[1], 10) : null;
    } catch { return null; }
}

function discoverAgents(memoriesDir: string): AgentInfo[] {
    const agents: AgentInfo[] = [];
    const seen = new Set<string>();
    try {
        const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md') && f !== '.gitkeep')
            .map(f => ({ name: f, mtime: fs.statSync(path.join(memoriesDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        for (const f of files) {
            const content = readFileSafe(path.join(memoriesDir, f.name));
            let agentName: string | null = null;
            const match = content.match(/\*\*Agent\*\*:\s*(.+)/i) || content.match(/Agent:\s*(.+)/i);
            if (match?.[1]) agentName = match[1].trim();
            else if (/_agent|agent_|-agent/i.test(f.name)) {
                agentName = f.name.replace(/\.md$/, '').replace(/[-_]completion|[-_]progress|[-_]result/gi, '').replace(/[-_]/g, ' ').trim();
            }
            if (agentName && !seen.has(agentName.toLowerCase())) {
                seen.add(agentName.toLowerCase());
                let status = 'unknown';
                if (/\[COMPLETED\]|## Completed/i.test(content)) status = 'completed';
                else if (/\[IN PROGRESS\]|IN PROGRESS/i.test(content)) status = 'running';
                else if (/\[FAILED\]|ERROR/i.test(content)) status = 'failed';
                const taskMatch = content.match(/## Task\s*\n+(.+)/i) || content.match(/\*\*Task\*\*:\s*(.+)/i);
                agents.push({ agent: agentName, status, task: taskMatch?.[1]?.trim().substring(0, 60) ?? '', turn: getAgentTurn(memoriesDir, agentName) });
            }
        }
    } catch { }
    return agents;
}

function getLatestActivity(memoriesDir: string): { agent: string; message: string; file: string }[] {
    try {
        const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md') && f !== '.gitkeep')
            .map(f => ({ name: f, mtime: fs.statSync(path.join(memoriesDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime).slice(0, 5);
        return files.map(f => {
            const name = f.name.replace(/^(progress|result|session|debug|task)-?/, '').replace(/[-_]agent/, '').replace(/\.md$/, '').replace(/[-_]/g, ' ').trim() || f.name.replace(/\.md$/, '');
            const content = readFileSafe(path.join(memoriesDir, f.name));
            const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('---') && l.length > 3);
            let message = '';
            for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i];
                if (!line) continue;
                if (/^\*\*|^#+|^-|^\d+\.|Status|Result|Action|Step/i.test(line)) {
                    message = line.replace(/^[#*\-\d.]+\s*/, '').replace(/\*\*/g, '').trim();
                    if (message.length > 5) break;
                }
            }
            if (message.length > 80) message = message.substring(0, 77) + '...';
            return { agent: name, message, file: f.name };
        }).filter(a => a.message);
    } catch { return []; }
}

function buildFullState(): DashboardState | null {
    const memoriesDir = getMemoriesDir();
    if (!memoriesDir) return null;
    const session = parseSessionInfo(memoriesDir);
    let agents = parseTaskBoard(memoriesDir).map(a => ({ ...a, turn: getAgentTurn(memoriesDir, a.agent) }));
    if (agents.length === 0) agents = discoverAgents(memoriesDir);
    return { session, agents, activity: getLatestActivity(memoriesDir), memoriesDir, updatedAt: new Date().toISOString() };
}

function getDashboardHtml(state: DashboardState | null): string {
    const noData = `<!DOCTYPE html><html><head><style>
        body{background:var(--vscode-editor-background,#0f0b1a);color:var(--vscode-foreground,#e8e0f0);font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        .msg{text-align:center;color:#8a7da0} .msg h2{margin-bottom:8px}
    </style></head><body><div class="msg"><h2>🎛️ Serena Memory Dashboard</h2><p>No .serena/memories/ directory found.<br>Run "Initialize Serena Memory" first.</p></div></body></html>`;
    if (!state) return noData;

    const agentRows = state.agents.length > 0
        ? state.agents.map(a => {
            const statusColors: Record<string, string> = { running: '#2ecc71', completed: '#1abc9c', failed: '#e74c3c', blocked: '#f1c40f' };
            const color = statusColors[a.status.toLowerCase()] || '#8a7da0';
            return `<tr><td>${a.agent}</td><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${a.status}</td><td>${a.turn ?? '-'}</td><td>${a.task}</td></tr>`;
        }).join('')
        : '<tr><td colspan="4" style="color:#8a7da0;font-style:italic">No agents detected yet</td></tr>';

    const activityItems = state.activity.length > 0
        ? state.activity.map(a => `<li><span style="color:#c39bd3;font-weight:600">[${a.agent}]</span> <span style="color:#8a7da0">${a.message}</span></li>`).join('')
        : '<li style="color:#8a7da0;font-style:italic">No activity yet</li>';

    const statusColor: Record<string, string> = { RUNNING: '#2ecc71', COMPLETED: '#1abc9c', FAILED: '#e74c3c' };
    const sColor = statusColor[state.session.status] || '#8a7da0';

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#0f0b1a);--surface:#1a1428;--surface2:#241e33;--border:#3d2e5c;--text:var(--vscode-foreground,#e8e0f0);--dim:#8a7da0;--purple:#c39bd3}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        .header{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:12px;border-bottom:2px solid var(--border)}
        .logo{width:40px;height:40px;background:linear-gradient(135deg,#9b59b6,#6c3483);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;color:white}
        h1{font-size:18px;color:var(--purple)}
        .session-bar{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:16px}
        .status-badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;background:rgba(255,255,255,0.1);color:${sColor}}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}
        .card-header{padding:10px 14px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--purple);background:var(--surface2)}
        .card-body{padding:14px}
        table{width:100%;border-collapse:collapse} th{text-align:left;padding:6px 10px;color:var(--dim);font-size:11px;text-transform:uppercase;border-bottom:1px solid var(--border)}
        td{padding:8px 10px;border-bottom:1px solid rgba(61,46,92,0.4)} tr:last-child td{border-bottom:none}
        ul{list-style:none} li{padding:6px 0;border-bottom:1px solid rgba(61,46,92,0.3);display:flex;gap:8px} li:last-child{border-bottom:none}
        .footer{margin-top:16px;text-align:center;color:var(--dim);font-size:11px}
        button{background:#9b59b6;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:auto}
    </style></head><body>
    <div class="header"><div class="logo">S</div><div><h1>Serena Memory Dashboard</h1><div style="font-size:11px;color:var(--dim)">Real-time agent orchestration monitor</div></div>
    <button onclick="acquireVsCodeApi().postMessage({type:'refresh'})">↻ Refresh</button></div>
    <div class="session-bar"><span>Session:</span><span style="font-weight:600">${state.session.id}</span><span class="status-badge">${state.session.status}</span>
    <span style="margin-left:auto;font-size:11px;color:var(--dim)">Updated ${new Date(state.updatedAt).toLocaleTimeString()}</span></div>
    <div class="grid">
        <div class="card"><div class="card-header">Agent Status</div><div class="card-body"><table><thead><tr><th>Agent</th><th>Status</th><th>Turn</th><th>Task</th></tr></thead><tbody>${agentRows}</tbody></table></div></div>
        <div class="card"><div class="card-header">Latest Activity</div><div class="card-body"><ul>${activityItems}</ul></div></div>
    </div>
    <div class="footer">oh-my-ag Dashboard</div>
    <script>const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{if(e.data.type==='update')document.location.reload()});</script>
    </body></html>`;
}

export function showDashboardPanel(): void {
    if (panel) { panel.reveal(); return; }

    panel = vscode.window.createWebviewPanel('ohMyAg.dashboard', '🎛️ Dashboard', vscode.ViewColumn.One, { enableScripts: true });
    panel.webview.html = getDashboardHtml(buildFullState());

    panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'refresh') panel!.webview.html = getDashboardHtml(buildFullState());
    });

    // Watch for .serena/memories changes
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
        const pattern = new vscode.RelativePattern(ws, '.serena/memories/**/*.md');
        watcher = vscode.workspace.createFileSystemWatcher(pattern);
        const update = () => {
            if (panel) panel.webview.html = getDashboardHtml(buildFullState());
        };
        watcher.onDidChange(update);
        watcher.onDidCreate(update);
        watcher.onDidDelete(update);
    }

    panel.onDidDispose(() => {
        panel = undefined;
        watcher?.dispose();
        watcher = undefined;
    });
}
