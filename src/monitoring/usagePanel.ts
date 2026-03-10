// ── Usage Panel (WebviewPanel) ──
// Visualizes Antigravity model quota and credits using LS RPC.

import * as vscode from 'vscode';
import { fetchQuota } from '../lsBridge';
import { QuotaSnapshot, ModelQuota } from '../types';

let panel: vscode.WebviewPanel | undefined;

function getHtml(snapshot: QuotaSnapshot | null): string {
    if (!snapshot) {
        return `<!DOCTYPE html><html><head><style>
            body{background:var(--vscode-editor-background,#1e1e2e);color:var(--vscode-foreground,#cdd6f4);font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
            .err{text-align:center} .err h2{color:#f38ba8;margin-bottom:12px} .err p{color:#a6adc8;font-size:14px}
            button{background:#89b4fa;color:#1e1e2e;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;margin-top:16px;font-size:13px}
            button:hover{background:#74c7ec}
        </style></head><body>
        <div class="err"><h2>⚠️ Connection Failed</h2><p>Could not connect to Antigravity Language Server.<br>Make sure Antigravity is running.</p>
        <button onclick="acquireVsCodeApi().postMessage({type:'refresh'})">Retry</button></div></body></html>`;
    }

    const modelRows = [...snapshot.models]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(m => {
            const pct = m.remainingPercent.toFixed(0);
            const barColor = m.remainingPercent > 60 ? '#a6e3a1' : m.remainingPercent > 30 ? '#f9e2af' : '#f38ba8';
            const exhaustedClass = m.isExhausted ? 'exhausted' : '';
            const reset = m.isExhausted ? `<span class="reset">resets ${m.timeUntilReset}</span>` : '';
            const img = m.supportsImages ? '<span class="badge">img</span>' : '';
            return `<tr class="${exhaustedClass}">
                <td>${m.label}${img}</td>
                <td><div class="bar"><div class="fill" style="width:${pct}%;background:${barColor}"></div></div></td>
                <td class="pct">${pct}%</td>
                <td>${reset}</td>
            </tr>`;
        }).join('');

    const creditSection = (label: string, c: { available: number; monthly: number; remainingPercent: number }) => {
        const barColor = c.remainingPercent > 60 ? '#a6e3a1' : c.remainingPercent > 30 ? '#f9e2af' : '#f38ba8';
        return `<div class="credit-row">
            <span class="credit-label">${label}</span>
            <div class="bar"><div class="fill" style="width:${c.remainingPercent}%;background:${barColor}"></div></div>
            <span class="credit-pct">${c.remainingPercent.toFixed(0)}%</span>
            <span class="credit-detail">${c.available.toLocaleString()} / ${c.monthly.toLocaleString()}</span>
        </div>`;
    };

    const creditsHtml = [
        snapshot.promptCredits ? creditSection('Prompt', snapshot.promptCredits) : '',
        snapshot.flowCredits ? creditSection('Flow', snapshot.flowCredits) : '',
    ].filter(Boolean).join('');

    return `<!DOCTYPE html><html><head><style>
        :root{--bg:var(--vscode-editor-background,#1e1e2e);--surface:#24273a;--border:#363a4f;--text:var(--vscode-foreground,#cdd6f4);--dim:#6c7086}
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:var(--bg);color:var(--text);font-family:system-ui;padding:20px;font-size:13px}
        h1{font-size:18px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
        .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}
        .card-title{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
        .info-row{display:flex;gap:12px;margin-bottom:6px} .info-label{color:var(--dim);min-width:60px} .info-value{font-weight:500}
        table{width:100%;border-collapse:collapse} th{text-align:left;padding:8px;color:var(--dim);font-size:11px;text-transform:uppercase;border-bottom:1px solid var(--border)}
        td{padding:8px;border-bottom:1px solid rgba(54,58,79,0.5)} tr:last-child td{border-bottom:none}
        .bar{width:120px;height:8px;background:#313244;border-radius:4px;overflow:hidden} .fill{height:100%;border-radius:4px;transition:width 0.3s}
        .pct{text-align:right;min-width:40px} .exhausted{opacity:0.5} .reset{color:#f38ba8;font-size:11px}
        .badge{background:#45475a;color:var(--dim);padding:1px 5px;border-radius:3px;font-size:10px;margin-left:6px}
        .credit-row{display:flex;align-items:center;gap:12px;margin-bottom:8px}
        .credit-label{min-width:60px;font-weight:500} .credit-pct{min-width:40px;text-align:right} .credit-detail{color:var(--dim);font-size:12px}
        .footer{margin-top:16px;text-align:center;color:var(--dim);font-size:11px}
        button{background:#89b4fa;color:#1e1e2e;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;margin-left:auto}
        button:hover{background:#74c7ec}
        .header-row{display:flex;align-items:center;margin-bottom:16px}
    </style></head><body>
    <div class="header-row"><h1>📈 oh-my-ag Usage</h1><button onclick="acquireVsCodeApi().postMessage({type:'refresh'})">↻ Refresh</button></div>
    <div class="card">
        <div class="card-title">Account</div>
        <div class="info-row"><span class="info-label">User</span><span class="info-value">${snapshot.userName}${snapshot.email ? ` (${snapshot.email})` : ''}</span></div>
        <div class="info-row"><span class="info-label">Plan</span><span class="info-value">${snapshot.planName}${snapshot.tierName ? ` (${snapshot.tierName})` : ''}</span></div>
        ${snapshot.defaultModel ? `<div class="info-row"><span class="info-label">Default</span><span class="info-value">${snapshot.models.find((m: ModelQuota) => m.modelId === snapshot.defaultModel)?.label ?? snapshot.defaultModel}</span></div>` : ''}
    </div>
    ${creditsHtml ? `<div class="card"><div class="card-title">Credits</div>${creditsHtml}</div>` : ''}
    <div class="card">
        <div class="card-title">Models (${snapshot.models.length})</div>
        <table><thead><tr><th>Model</th><th>Remaining</th><th></th><th></th></tr></thead><tbody>${modelRows}</tbody></table>
    </div>
    <div class="footer">Updated ${snapshot.timestamp.toLocaleTimeString()}</div>
    <script>const vscode=acquireVsCodeApi();window.addEventListener('message',e=>{if(e.data.type==='update')document.location.reload()});</script>
    </body></html>`;
}

let refreshInterval: NodeJS.Timeout | undefined;

export async function showUsagePanel(allowInsecure: boolean): Promise<void> {
    if (panel) {
        panel.reveal();
    } else {
        panel = vscode.window.createWebviewPanel('ohMyAg.usage', '📈 Usage', vscode.ViewColumn.One, { enableScripts: true });
        panel.onDidDispose(() => {
            panel = undefined;
            if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = undefined; }
        });
        panel.webview.onDidReceiveMessage(async msg => {
            if (msg.type === 'refresh') {
                const snap = await fetchQuota(allowInsecure);
                panel!.webview.html = getHtml(snap);
            }
        });

        // Auto-refresh every 30 seconds
        refreshInterval = setInterval(async () => {
            if (panel) {
                const snap = await fetchQuota(allowInsecure);
                panel.webview.html = getHtml(snap);
            }
        }, 30_000);
    }
    const snap = await fetchQuota(allowInsecure);
    panel.webview.html = getHtml(snap);
}
