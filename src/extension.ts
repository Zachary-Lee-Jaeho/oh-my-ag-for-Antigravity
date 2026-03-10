// ── oh-my-ag for Antigravity — Extension Entry Point ──
// Registers all commands, TreeViews, Status Bar items, and auto-installs skills + CLI.

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { SkillsTreeProvider } from './skills/skillsProvider';
import { autoInstallIfNeeded, installSkillsCommand, updateSkillsCommand } from './skills/installer';
import { AgentsTreeProvider } from './agents/agentsProvider';
import { spawnAgentCommand, parallelSpawnCommand } from './agents/spawner';
import { verifyAgentCommand } from './agents/verifier';
import { showUsagePanel } from './monitoring/usagePanel';
import { showDashboardPanel } from './monitoring/dashboardPanel';
import { showStatsPanel } from './monitoring/statsPanel';
import { showRetroPanel } from './monitoring/retroPanel';
import { QuickStatsProvider } from './monitoring/quickStats';
import { doctorCommand } from './doctor';
import { memoryInitCommand } from './infra/memory';
import { cleanupCommand } from './infra/cleanup';
import { getInstalledSkills } from './skills/installer';
import { fetchQuota } from './lsBridge';

let statusBarItem: vscode.StatusBarItem;
let refreshTimer: NodeJS.Timeout | undefined;

/** Check if oh-my-ag CLI is globally installed, auto-install if not */
async function ensureOhMyAgCli(): Promise<void> {
    try {
        execSync('oh-my-ag --version', { stdio: 'pipe', encoding: 'utf-8' });
        return; // already installed
    } catch { /* not installed */ }

    // Also check via npx dry-run
    try {
        execSync('which oh-my-ag', { stdio: 'pipe' });
        return;
    } catch { /* not found */ }

    const choice = await vscode.window.showInformationMessage(
        'oh-my-ag CLI is not installed globally. Install it for multi-agent spawn support?',
        'Install (npm)', 'Install (bun)', 'Skip'
    );

    if (!choice || choice === 'Skip') return;

    const cmd = choice === 'Install (bun)'
        ? 'bun install --global oh-my-ag'
        : 'npm install -g oh-my-ag';

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Installing oh-my-ag globally...`, cancellable: false },
        async () => {
            try {
                execSync(cmd, { stdio: 'pipe', timeout: 60_000 });
                vscode.window.showInformationMessage('✅ oh-my-ag CLI installed globally! Multi-agent spawn is now available.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to install oh-my-ag: ${err instanceof Error ? err.message : err}`);
            }
        }
    );
}

export function activate(context: vscode.ExtensionContext) {
    // ── Auto-install skills if workspace has none ──
    autoInstallIfNeeded(context);

    // ── Auto-install oh-my-ag CLI globally if missing ──
    ensureOhMyAgCli();

    // ── TreeView Providers ──
    const skillsProvider = new SkillsTreeProvider();
    const agentsProvider = new AgentsTreeProvider();
    const quickStatsProvider = new QuickStatsProvider();

    vscode.window.registerTreeDataProvider('ohMyAg.skills', skillsProvider);
    vscode.window.registerTreeDataProvider('ohMyAg.agents', agentsProvider);
    vscode.window.registerTreeDataProvider('ohMyAg.quickStats', quickStatsProvider);

    // ── Commands ──
    const allowInsecure = () => vscode.workspace.getConfiguration('ohMyAg').get('allowInsecureTls', false);

    context.subscriptions.push(
        // Skills
        vscode.commands.registerCommand('ohMyAg.installSkills', () => installSkillsCommand(context)),
        vscode.commands.registerCommand('ohMyAg.updateSkills', () => updateSkillsCommand(context)),
        vscode.commands.registerCommand('ohMyAg.refreshSkills', () => {
            skillsProvider.refresh();
            quickStatsProvider.refresh();
        }),

        // Monitoring
        vscode.commands.registerCommand('ohMyAg.usage', () => showUsagePanel(allowInsecure())),
        vscode.commands.registerCommand('ohMyAg.dashboard', () => showDashboardPanel()),
        vscode.commands.registerCommand('ohMyAg.stats', () => showStatsPanel()),
        vscode.commands.registerCommand('ohMyAg.retro', () => showRetroPanel()),

        // Agents
        vscode.commands.registerCommand('ohMyAg.spawnAgent', () => spawnAgentCommand()),
        vscode.commands.registerCommand('ohMyAg.refreshAgents', () => agentsProvider.refresh()),
        vscode.commands.registerCommand('ohMyAg.verifyAgent', () => verifyAgentCommand()),

        // Infrastructure
        vscode.commands.registerCommand('ohMyAg.doctor', () => doctorCommand()),
        vscode.commands.registerCommand('ohMyAg.memoryInit', () => memoryInitCommand()),
        vscode.commands.registerCommand('ohMyAg.cleanup', () => cleanupCommand()),
    );

    // ── Status Bar ──
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.command = 'ohMyAg.usage';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // Refresh status bar periodically (every 60s)
    refreshTimer = setInterval(updateStatusBar, 60_000);
    context.subscriptions.push({ dispose: () => { if (refreshTimer) clearInterval(refreshTimer); } });

    // Watch for .agent/skills changes to refresh TreeView
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
        const skillsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(ws, '.agent/skills/**')
        );
        skillsWatcher.onDidChange(() => skillsProvider.refresh());
        skillsWatcher.onDidCreate(() => skillsProvider.refresh());
        skillsWatcher.onDidDelete(() => skillsProvider.refresh());
        context.subscriptions.push(skillsWatcher);
    }

    console.log('oh-my-ag extension activated');
}

async function updateStatusBar() {
    const installed = getInstalledSkills();
    statusBarItem.text = `$(rocket) oh-my-ag [${installed.length}/12]`;
    statusBarItem.tooltip = `oh-my-ag: ${installed.length} skills installed\nClick to view usage quota`;
    statusBarItem.show();
}

export function deactivate() {
    if (refreshTimer) clearInterval(refreshTimer);
}
