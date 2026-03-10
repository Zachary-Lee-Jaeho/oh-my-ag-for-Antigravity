// ── Agents TreeView Provider ──
// Displays running/completed agents from Serena memory files.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentInfo } from '../types';

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        // Auto-refresh when .serena/memories changes
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

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    dispose(): void {
        this.watcher?.dispose();
    }

    getTreeItem(element: AgentTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(): AgentTreeItem[] {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return [new AgentTreeItem('No workspace open', '', 'info')];

        const memoriesDir = path.join(ws.uri.fsPath, '.serena', 'memories');
        if (!fs.existsSync(memoriesDir)) {
            return [new AgentTreeItem('No Serena memory found', 'Run "Initialize Memory"', 'info')];
        }

        const agents = this.discoverAgents(memoriesDir);
        if (agents.length === 0) {
            return [new AgentTreeItem('No agents detected', '', 'info')];
        }

        return agents.map(a => new AgentTreeItem(
            a.agent,
            `${a.status}${a.turn != null ? ` • Turn ${a.turn}` : ''}${a.task ? ` — ${a.task}` : ''}`,
            a.status.toLowerCase() as any
        ));
    }

    private discoverAgents(memoriesDir: string): AgentInfo[] {
        const agents: AgentInfo[] = [];
        const seen = new Set<string>();

        try {
            // Check task-board.md first
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

            // Discover from files
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

            // Progress files
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
    constructor(label: string, description: string, kind: 'running' | 'completed' | 'failed' | 'unknown' | 'info' | 'pending') {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        const icons: Record<string, string> = {
            running: 'sync~spin', completed: 'pass', failed: 'error',
            unknown: 'question', info: 'info', pending: 'clock',
        };
        this.iconPath = new vscode.ThemeIcon(icons[kind] || 'circle-outline');
    }
}
