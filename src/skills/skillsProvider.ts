// ── Skills TreeView Provider ──
// Displays installed/available skills in the sidebar with click-to-open.

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
        if (element) return [];

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

        // Action buttons at top
        items.push(new SkillTreeItem('▶ Install Skills Preset', 'click to run', false, 'action', 'ohMyAg.installSkills'));
        items.push(new SkillTreeItem('↻ Update All Skills', 'click to update', false, 'action', 'ohMyAg.updateSkills'));
        items.push(new SkillTreeItem('🩺 Run Doctor', 'check environment', false, 'action', 'ohMyAg.doctor'));
        items.push(new SkillTreeItem('', '', false, 'separator'));

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
            items.push(header);

            for (const skill of skills) {
                const isInstalled = installed.has(skill.name);
                // If installed, clicking opens the SKILL.md file
                const skillMdPath = isInstalled
                    ? path.join(skillsDir, skill.name, 'SKILL.md')
                    : undefined;
                items.push(new SkillTreeItem(skill.name, skill.desc, isInstalled, 'skill', undefined, skillMdPath));
            }
        }

        if (items.length <= 4) { // only action items
            items.push(new SkillTreeItem('No skills found. Click "Install Skills" above.', '', false, 'info'));
        }

        return items;
    }
}

class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skillName: string,
        public readonly desc: string,
        public readonly installed: boolean,
        public readonly kind: 'skill' | 'header' | 'info' | 'action' | 'separator',
        commandId?: string,
        filePath?: string,
    ) {
        super(skillName, vscode.TreeItemCollapsibleState.None);

        if (kind === 'skill') {
            this.description = desc;
            this.iconPath = new vscode.ThemeIcon(installed ? 'check' : 'circle-outline');
            this.tooltip = `${skillName}: ${desc}\n${installed ? '✅ Installed — Click to open SKILL.md' : '❌ Not installed'}`;
            // Click to open SKILL.md
            if (filePath && fs.existsSync(filePath)) {
                this.command = {
                    command: 'vscode.open',
                    title: 'Open SKILL.md',
                    arguments: [vscode.Uri.file(filePath)],
                };
            }
        } else if (kind === 'action') {
            this.description = desc;
            this.iconPath = new vscode.ThemeIcon('play');
            if (commandId) {
                this.command = { command: commandId, title: skillName };
            }
        } else if (kind === 'separator') {
            this.description = '──────────────────';
            this.iconPath = undefined;
        } else if (kind === 'header') {
            this.iconPath = undefined;
        } else {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}
