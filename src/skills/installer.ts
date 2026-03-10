// ── Skills Installer ──
// Copies bundled skills/workflows from the extension directory into the workspace's .agent/ folder.
// Runs automatically on activation so that a bare .vsix install gives full functionality.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SKILLS_REGISTRY, SkillInfo } from '../types';

const PRESETS: Record<string, string[]> = {
    '✨ All': SKILLS_REGISTRY.map(s => s.name),
    '🌐 Fullstack': ['brainstorm', 'frontend-agent', 'backend-agent', 'pm-agent', 'qa-agent', 'debug-agent', 'commit', 'tf-infra-agent', 'developer-workflow'],
    '🎨 Frontend': ['brainstorm', 'frontend-agent', 'pm-agent', 'qa-agent', 'debug-agent', 'commit'],
    '⚙️ Backend': ['brainstorm', 'backend-agent', 'pm-agent', 'qa-agent', 'debug-agent', 'commit'],
    '📱 Mobile': ['brainstorm', 'mobile-agent', 'pm-agent', 'qa-agent', 'debug-agent', 'commit'],
};

/** Get the path to bundled-skills inside the installed extension */
function getBundledSkillsPath(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'bundled-skills');
}

/** Recursively copy directory contents */
function copyDirSync(src: string, dest: string): void {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/** Install specific skills to a target workspace directory */
function installSkillsToWorkspace(
    bundledPath: string,
    workspaceRoot: string,
    skillNames: string[]
): { installed: string[]; skipped: string[] } {
    const installed: string[] = [];
    const skipped: string[] = [];

    const agentDir = path.join(workspaceRoot, '.agent');
    const skillsDir = path.join(agentDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    // Install _shared first
    const sharedSrc = path.join(bundledPath, 'skills', '_shared');
    const sharedDest = path.join(skillsDir, '_shared');
    if (fs.existsSync(sharedSrc)) {
        copyDirSync(sharedSrc, sharedDest);
    }

    // Install _version.json
    const versionSrc = path.join(bundledPath, 'skills', '_version.json');
    if (fs.existsSync(versionSrc)) {
        fs.copyFileSync(versionSrc, path.join(skillsDir, '_version.json'));
    }

    // Install each selected skill
    for (const name of skillNames) {
        const src = path.join(bundledPath, 'skills', name);
        if (!fs.existsSync(src)) {
            skipped.push(name);
            continue;
        }
        const dest = path.join(skillsDir, name);
        copyDirSync(src, dest);
        installed.push(name);
    }

    // Install workflows
    const workflowsSrc = path.join(bundledPath, 'workflows');
    const workflowsDest = path.join(agentDir, 'workflows');
    if (fs.existsSync(workflowsSrc)) {
        copyDirSync(workflowsSrc, workflowsDest);
    }

    // Install config
    const configSrc = path.join(bundledPath, 'config');
    const configDest = path.join(agentDir, 'config');
    if (fs.existsSync(configSrc)) {
        copyDirSync(configSrc, configDest);
    }

    // Install mcp.json
    const mcpSrc = path.join(bundledPath, 'mcp.json');
    const mcpDest = path.join(agentDir, 'mcp.json');
    if (fs.existsSync(mcpSrc) && !fs.existsSync(mcpDest)) {
        fs.copyFileSync(mcpSrc, mcpDest);
    }

    // Create brain directory
    const brainDir = path.join(agentDir, 'brain');
    if (!fs.existsSync(brainDir)) {
        fs.mkdirSync(brainDir, { recursive: true });
        const gitkeep = path.join(brainDir, '.gitkeep');
        if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
    }

    return { installed, skipped };
}

/** Auto-install all skills if workspace has no .agent/skills/ yet */
export function autoInstallIfNeeded(context: vscode.ExtensionContext): void {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return;

    const skillsDir = path.join(ws.uri.fsPath, '.agent', 'skills');
    if (fs.existsSync(skillsDir)) return; // already installed

    const bundled = getBundledSkillsPath(context);
    if (!fs.existsSync(bundled)) return;

    const allSkills = SKILLS_REGISTRY.map(s => s.name);
    const result = installSkillsToWorkspace(bundled, ws.uri.fsPath, allSkills);
    if (result.installed.length > 0) {
        vscode.window.showInformationMessage(
            `oh-my-ag: Auto-installed ${result.installed.length} skills + workflows`
        );
    }
}

/** Command: Interactive skill installation with preset selection */
export async function installSkillsCommand(context: vscode.ExtensionContext): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const presetNames = Object.keys(PRESETS);
    const selected = await vscode.window.showQuickPick(presetNames, {
        placeHolder: 'Select a skill preset to install',
        title: 'oh-my-ag: Install Skills',
    });
    if (!selected) return;

    const skillNames = PRESETS[selected] ?? [];
    const bundled = getBundledSkillsPath(context);

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Installing skills...' },
        async (progress) => {
            progress.report({ increment: 0 });
            const result = installSkillsToWorkspace(bundled, ws.uri.fsPath, skillNames);
            progress.report({ increment: 100 });

            vscode.window.showInformationMessage(
                `oh-my-ag: Installed ${result.installed.length} skills` +
                (result.skipped.length > 0 ? ` (${result.skipped.length} skipped)` : '')
            );
        }
    );
}

/** Command: Update skills to latest bundled version */
export async function updateSkillsCommand(context: vscode.ExtensionContext): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const bundled = getBundledSkillsPath(context);
    const skillsDir = path.join(ws.uri.fsPath, '.agent', 'skills');
    if (!fs.existsSync(skillsDir)) {
        vscode.window.showWarningMessage('No skills installed. Use "Install Skills" first.');
        return;
    }

    // Find currently installed skills
    const installed = fs.readdirSync(skillsDir)
        .filter(d => !d.startsWith('_') && fs.statSync(path.join(skillsDir, d)).isDirectory());

    const result = installSkillsToWorkspace(bundled, ws.uri.fsPath, installed);
    vscode.window.showInformationMessage(
        `oh-my-ag: Updated ${result.installed.length} skills`
    );
}

/** Get list of installed skills in workspace */
export function getInstalledSkills(): string[] {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) return [];

    const skillsDir = path.join(ws.uri.fsPath, '.agent', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    return fs.readdirSync(skillsDir)
        .filter(d => !d.startsWith('_') && fs.statSync(path.join(skillsDir, d)).isDirectory());
}
