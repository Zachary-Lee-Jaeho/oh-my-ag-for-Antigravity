// ── Agents TreeView Provider ──
// Displays running/completed agents with click-to-open progress files.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentInfo } from '../types';

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (ws) {
            this.watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(ws, '.serena/memories/**/*.md')
            );
            this.watcher.onDidChange(() => this.refresh());
            this.watcher.onDidCreate(() => this.refresh());
            this.watcher.onDidDelete(() => this.refresh());
        }
    }

    refresh(): void { this._onDidChangeTreeData.fire(undefined); }
    dispose(): void { this.watcher?.dispose(); }
    getTreeItem(element: AgentTreeItem): vscode.TreeItem { return element; }

    getChildren(): AgentTreeItem[] {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return [new AgentTreeItem('No workspace open', '', 'info')];

        const memoriesDir = path.join(ws.uri.fsPath, '.serena', 'memories');

        // Action buttons at top
        const items: AgentTreeItem[] = [];
        items.push(new AgentTreeItem('▶ Spawn Agent', 'select type & start', 'action', 'ohMyAg.spawnAgent'));
        items.push(new AgentTreeItem('📈 Show Usage', 'view model quota', 'action', 'ohMyAg.usage'));
        items.push(new AgentTreeItem('🎛️ Dashboard', 'real-time monitor', 'action', 'ohMyAg.dashboard'));
        items.push(new AgentTreeItem('✅ Verify Agent', 'check output quality', 'action', 'ohMyAg.verifyAgent'));
        items.push(new AgentTreeItem('', '──────────────────', 'separator'));

        if (!fs.existsSync(memoriesDir)) {
            items.push(new AgentTreeItem('No Serena memory found', '', 'info', 'ohMyAg.memoryInit'));
            items.push(new AgentTreeItem('▶ Initialize Memory', 'click to create', 'action', 'ohMyAg.memoryInit'));
            return items;
        }

        const agents = this.discoverAgents(memoriesDir);
        if (agents.length === 0) {
            items.push(new AgentTreeItem('No agents detected', 'spawn one above', 'info'));
            return items;
        }

        for (const a of agents) {
            // Find the agent's progress file to open on click
            const progressFile = this.findAgentFile(memoriesDir, a.agent);
            items.push(new AgentTreeItem(
                a.agent,
                `${a.status}${a.turn != null ? ` • Turn ${a.turn}` : ''}${a.task ? ` — ${a.task}` : ''}`,
                a.status.toLowerCase() as any,
                undefined,
                progressFile
            ));
        }

        return items;
    }

    private findAgentFile(memoriesDir: string, agent: string): string | undefined {
        try {
            const candidates = fs.readdirSync(memoriesDir)
                .filter(f => f.includes(agent) && f.endsWith('.md'))
                .map(f => ({ name: f, mtime: fs.statSync(path.join(memoriesDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);
            return candidates[0] ? path.join(memoriesDir, candidates[0].name) : undefined;
        } catch { return undefined; }
    }

    private discoverAgents(memoriesDir: string): AgentInfo[] {
        const agents: AgentInfo[] = [];
        const seen = new Set<string>();

        try {
            const taskBoard = path.join(memoriesDir, 'task-board.md');
            if (fs.existsSync(taskBoard)) {
                const content = fs.readFileSync(taskBoard, 'utf-8');
                for (const line of content.split('\n')) {
                    if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue;
                    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
                    if (cols.length < 2 || !cols[0] || /^agent$/i.test(cols[0])) continue;
                    if (!seen.has(cols[0].toLowerCase())) {
                        seen.add(cols[0].toLowerCase());
                        agents.push({ agent: cols[0], status: cols[1] || 'pending', task: cols[2] || '', turn: this.getAgentTurn(memoriesDir, cols[0]) });
                    }
                }
            }

            const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md') && f !== '.gitkeep')
                .map(f => ({ name: f, mtime: fs.statSync(path.join(memoriesDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime);

            for (const f of files) {
                const content = fs.readFileSync(path.join(memoriesDir, f.name), 'utf-8');
                let agentName: string | null = null;
                const match = content.match(/\*\*Agent\*\*:\s*(.+)/i) || content.match(/Agent:\s*(.+)/i);
                if (match?.[1]) agentName = match[1].trim();
                else if (/_agent|agent_|-agent/i.test(f.name)) {
                    agentName = f.name.replace(/\.md$/, '').replace(/[-_]completion|[-_]progress|[-_]result/gi, '').replace(/[-_]/g, ' ').trim();
                }
                if (agentName && !seen.has(agentName.toLowerCase())) {
                    seen.add(agentName.toLowerCase());
                    let status = 'unknown';
                    if (/\[COMPLETED\]/i.test(content)) status = 'completed';
                    else if (/\[IN PROGRESS\]/i.test(content)) status = 'running';
                    else if (/\[FAILED\]/i.test(content)) status = 'failed';
                    agents.push({ agent: agentName, status, task: '', turn: this.getAgentTurn(memoriesDir, agentName) });
                }
            }

            const progressFiles = fs.readdirSync(memoriesDir).filter(f => f.startsWith('progress-') && f.endsWith('.md'));
            for (const f of progressFiles) {
                const agent = f.replace(/^progress-/, '').replace(/\.md$/, '');
                if (!seen.has(agent.toLowerCase())) {
                    seen.add(agent.toLowerCase());
                    agents.push({ agent, status: 'running', task: '', turn: this.getAgentTurn(memoriesDir, agent) });
                }
            }
        } catch { }

        return agents;
    }

    private getAgentTurn(memoriesDir: string, agent: string): number | null {
        try {
            const files = fs.readdirSync(memoriesDir)
                .filter(f => f.startsWith(`progress-${agent}`) && f.endsWith('.md'))
                .sort().reverse();
            if (files.length === 0) return null;
            const content = files[0] ? fs.readFileSync(path.join(memoriesDir, files[0]), 'utf-8') : '';
            const match = content.match(/turn[:\s]*(\d+)/i);
            return match?.[1] ? parseInt(match[1], 10) : null;
        } catch { return null; }
    }
}

class AgentTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        description: string,
        kind: 'running' | 'completed' | 'failed' | 'unknown' | 'info' | 'pending' | 'action' | 'separator',
        commandId?: string,
        filePath?: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;

        if (kind === 'action') {
            this.iconPath = new vscode.ThemeIcon('play');
            if (commandId) this.command = { command: commandId, title: label };
        } else if (kind === 'separator') {
            this.iconPath = undefined;
        } else if (kind === 'info') {
            this.iconPath = new vscode.ThemeIcon('info');
            if (commandId) this.command = { command: commandId, title: label };
        } else {
            const icons: Record<string, string> = {
                running: 'sync~spin', completed: 'pass', failed: 'error',
                unknown: 'question', pending: 'clock',
            };
            this.iconPath = new vscode.ThemeIcon(icons[kind] || 'circle-outline');
            // Click to open the agent's progress/result file
            if (filePath && fs.existsSync(filePath)) {
                this.command = {
                    command: 'vscode.open',
                    title: 'Open Agent File',
                    arguments: [vscode.Uri.file(filePath)],
                };
                this.tooltip = `Click to open ${path.basename(filePath)}`;
            }
        }
    }
}
