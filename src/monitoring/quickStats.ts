// ── Quick Stats TreeView ──
// Sidebar TreeView showing session summary statistics.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SKILLS_REGISTRY } from '../types';
import { getInstalledSkills } from '../skills/installer';

export class QuickStatsProvider implements vscode.TreeDataProvider<StatItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StatItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: StatItem): vscode.TreeItem {
        return element;
    }

    getChildren(): StatItem[] {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return [new StatItem('No workspace', '', 'info')];
        const cwd = ws.uri.fsPath;

        const items: StatItem[] = [];

        // Skills count
        const installed = getInstalledSkills();
        items.push(new StatItem(`Skills: ${installed.length}/${SKILLS_REGISTRY.length}`, 'installed', 'extensions'));

        // Serena memory
        const memoriesDir = path.join(cwd, '.serena', 'memories');
        const hasMemories = fs.existsSync(memoriesDir);
        if (hasMemories) {
            try {
                const count = fs.readdirSync(memoriesDir).filter(f => f.endsWith('.md')).length;
                items.push(new StatItem(`Serena: ${count} files`, 'active', 'database'));
            } catch {
                items.push(new StatItem('Serena: error', '', 'warning'));
            }
        } else {
            items.push(new StatItem('Serena: not initialized', '', 'circle-outline'));
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
                const count = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md')).length;
                items.push(new StatItem(`Workflows: ${count}`, '', 'list-ordered'));
            } catch { }
        }

        return items;
    }
}

class StatItem extends vscode.TreeItem {
    constructor(label: string, description: string, iconId: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(iconId);
    }
}
