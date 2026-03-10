// ── Quick Stats TreeView ──
// Sidebar TreeView showing session summary with clickable actions.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SKILLS_REGISTRY } from '../types';
import { getInstalledSkills } from '../skills/installer';

export class QuickStatsProvider implements vscode.TreeDataProvider<StatItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StatItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void { this._onDidChangeTreeData.fire(undefined); }
    getTreeItem(element: StatItem): vscode.TreeItem { return element; }

    getChildren(): StatItem[] {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return [new StatItem('No workspace', '', 'info')];
        const cwd = ws.uri.fsPath;
        const items: StatItem[] = [];

        // Clickable action stats
        const installed = getInstalledSkills();
        items.push(new StatItem(
            `Skills: ${installed.length}/${SKILLS_REGISTRY.length}`,
            installed.length === SKILLS_REGISTRY.length ? 'all installed ✓' : 'click to install more',
            'extensions',
            'ohMyAg.installSkills'
        ));

        // Serena memory
        const memoriesDir = path.join(cwd, '.serena', 'memories');
        const hasMemories = fs.existsSync(memoriesDir);
        if (hasMemories) {
            try {
                const count = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md')).length;
                items.push(new StatItem(`Serena: ${count} files`, 'click for dashboard', 'database', 'ohMyAg.dashboard'));
            } catch {
                items.push(new StatItem('Serena: error', '', 'warning'));
            }
        } else {
            items.push(new StatItem('Serena: not initialized', 'click to init', 'circle-outline', 'ohMyAg.memoryInit'));
        }

        // Git info
        try {
            const branch = execSync('git branch --show-current 2>/dev/null', { cwd, encoding: 'utf-8' }).trim();
            const commitCount = execSync('git rev-list --count HEAD 2>/dev/null || echo 0', { cwd, encoding: 'utf-8' }).trim();
            items.push(new StatItem(`Git: ${branch}`, `${commitCount} commits`, 'git-branch'));
        } catch {
            items.push(new StatItem('Git: not available', '', 'circle-outline'));
        }

        // Workflows
        const workflowsDir = path.join(cwd, '.agent', 'workflows');
        if (fs.existsSync(workflowsDir)) {
            try {
                const wfFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
                items.push(new StatItem(`Workflows: ${wfFiles.length}`, 'type / in chat to use', 'list-ordered'));
            } catch { }
        }

        // Separator + Panel shortcuts
        items.push(new StatItem('', '──────────────────', 'blank'));
        items.push(new StatItem('📈 Usage Quota', 'click to view', 'graph', 'ohMyAg.usage'));
        items.push(new StatItem('📊 Stats', 'productivity metrics', 'pulse', 'ohMyAg.stats'));
        items.push(new StatItem('📝 Retro', 'session retrospective', 'book', 'ohMyAg.retro'));
        items.push(new StatItem('🧹 Cleanup', 'orphan processes', 'trash', 'ohMyAg.cleanup'));

        return items;
    }
}

class StatItem extends vscode.TreeItem {
    constructor(label: string, description: string, iconId: string, commandId?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        if (iconId === 'blank') {
            this.iconPath = undefined;
        } else {
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
        if (commandId) {
            this.command = { command: commandId, title: label };
        }
    }
}
