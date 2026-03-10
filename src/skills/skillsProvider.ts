// ── Skills TreeView Provider ──
// Displays installed/available skills in the sidebar.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SKILLS_REGISTRY, SkillInfo } from '../types';

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SkillTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillTreeItem): SkillTreeItem[] {
        if (element) return []; // flat list

        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) return [new SkillTreeItem('No workspace open', '', false, 'info')];

        const skillsDir = path.join(ws.uri.fsPath, '.agent', 'skills');
        const installed = new Set<string>();
        if (fs.existsSync(skillsDir)) {
            for (const d of fs.readdirSync(skillsDir)) {
                if (!d.startsWith('_') && fs.statSync(path.join(skillsDir, d)).isDirectory()) {
                    installed.add(d);
                }
            }
        }

        const items: SkillTreeItem[] = [];

        // Group by category
        const categories: Record<string, SkillInfo[]> = { domain: [], coordination: [], utility: [], infrastructure: [] };
        for (const skill of SKILLS_REGISTRY) {
            categories[skill.category]?.push(skill);
        }

        const categoryLabels: Record<string, string> = {
            domain: '🏗️ Domain',
            coordination: '🎯 Coordination',
            utility: '🔧 Quality & Utility',
            infrastructure: '☁️ Infrastructure',
        };

        for (const [cat, skills] of Object.entries(categories)) {
            if (skills.length === 0) continue;
            const header = new SkillTreeItem(categoryLabels[cat] ?? cat, '', false, 'header');
            header.collapsibleState = vscode.TreeItemCollapsibleState.None;
            items.push(header);

            for (const skill of skills) {
                const isInstalled = installed.has(skill.name);
                items.push(new SkillTreeItem(skill.name, skill.desc, isInstalled, 'skill'));
            }
        }

        if (items.length === 0) {
            return [new SkillTreeItem('No skills found. Run "Install Skills".', '', false, 'info')];
        }

        return items;
    }
}

class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skillName: string,
        public readonly desc: string,
        public readonly installed: boolean,
        public readonly kind: 'skill' | 'header' | 'info',
    ) {
        super(skillName, vscode.TreeItemCollapsibleState.None);

        if (kind === 'skill') {
            this.description = desc;
            this.iconPath = new vscode.ThemeIcon(installed ? 'check' : 'circle-outline');
            this.tooltip = `${skillName}: ${desc}\n${installed ? '✅ Installed' : '❌ Not installed'}`;
        } else if (kind === 'header') {
            this.iconPath = undefined;
        } else {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}
