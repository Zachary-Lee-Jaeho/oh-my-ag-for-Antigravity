// ── Agent Spawner ──
// Spawns AI agents via VS Code Terminal API — ported from oh-my-ag's agent.ts
// Supports gemini, claude, codex, qwen CLI tools.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface VendorConfig {
    command: string;
    promptFlag: string;
    autoApproveFlag: string;
}

const VENDORS: Record<string, VendorConfig> = {
    gemini: { command: 'gemini', promptFlag: '-p', autoApproveFlag: '--sandbox' },
    claude: { command: 'claude', promptFlag: '-p', autoApproveFlag: '--dangerously-skip-permissions' },
    codex: { command: 'codex', promptFlag: '-p', autoApproveFlag: '--approval-mode full-auto' },
    qwen: { command: 'qwen', promptFlag: '-p', autoApproveFlag: '--sandbox' },
};

const AGENT_TYPES = [
    { label: '🏗️ Frontend Agent', value: 'frontend', desc: 'React/Next.js UI development' },
    { label: '⚙️ Backend Agent', value: 'backend', desc: 'FastAPI/PostgreSQL API development' },
    { label: '📱 Mobile Agent', value: 'mobile', desc: 'Flutter cross-platform development' },
    { label: '🎯 PM Agent', value: 'pm', desc: 'Requirements analysis and task decomposition' },
    { label: '🔍 QA Agent', value: 'qa', desc: 'Security, performance, accessibility testing' },
    { label: '🐛 Debug Agent', value: 'debug', desc: 'Bug diagnosis and root cause analysis' },
    { label: '💡 Brainstorm', value: 'brainstorm', desc: 'Design-first ideation' },
];

/** Detect available CLI vendor (check which is installed) */
function detectVendor(): string {
    const { execSync } = require('child_process');
    for (const vendor of ['gemini', 'claude', 'codex', 'qwen']) {
        try {
            execSync(`which ${vendor}`, { stdio: 'pipe' });
            return vendor;
        } catch { /* not installed */ }
    }
    return 'gemini'; // default
}

/** Read user-preferences.yaml if present */
function readUserPreferences(cwd: string): { default_cli?: string; agent_cli_mapping?: Record<string, string> } {
    const prefPath = path.join(cwd, '.agent', 'config', 'user-preferences.yaml');
    if (!fs.existsSync(prefPath)) return {};
    try {
        const content = fs.readFileSync(prefPath, 'utf-8');
        // Simple YAML parsing for key: value
        const result: any = {};
        for (const line of content.split('\n')) {
            const match = line.match(/^(\w+):\s*(.+)/);
            if (match) result[match[1]] = match[2].trim();
        }
        return result;
    } catch { return {}; }
}

/** Command: Spawn a single agent */
export async function spawnAgentCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    // Select agent type
    const agentPick = await vscode.window.showQuickPick(AGENT_TYPES, {
        placeHolder: 'Select agent type to spawn',
        title: 'oh-my-ag: Spawn Agent',
    });
    if (!agentPick) return;

    // Get prompt
    const prompt = await vscode.window.showInputBox({
        prompt: `Enter task for ${agentPick.label}`,
        placeHolder: 'e.g., "Create a login form with validation"',
    });
    if (!prompt) return;

    // Select vendor
    const prefs = readUserPreferences(ws.uri.fsPath);
    const defaultVendor = prefs.agent_cli_mapping?.[agentPick.value] || prefs.default_cli || detectVendor();
    const vendorNames = Object.keys(VENDORS);
    const vendorPick = await vscode.window.showQuickPick(
        vendorNames.map(v => ({ label: v, description: v === defaultVendor ? '(default)' : '' })),
        { placeHolder: `Select CLI vendor (default: ${defaultVendor})`, title: 'CLI Vendor' }
    );
    const vendor = vendorPick?.label || defaultVendor;
    const config = VENDORS[vendor];
    if (!config) {
        vscode.window.showErrorMessage(`Unknown vendor: ${vendor}`);
        return;
    }

    // Build command  
    const fullPrompt = `You are a ${agentPick.value} agent. ${prompt}`;
    const cmd = `${config.command} ${config.promptFlag} ${JSON.stringify(fullPrompt)}`;

    // Create terminal and run
    const terminal = vscode.window.createTerminal({
        name: `🤖 ${agentPick.label}`,
        cwd: ws.uri.fsPath,
    });
    terminal.show();
    terminal.sendText(cmd);

    vscode.window.showInformationMessage(`Spawned ${agentPick.label} via ${vendor}`);
}

/** Command: Spawn multiple agents in parallel */
export async function parallelSpawnCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    // Multi-select agent types
    const selected = await vscode.window.showQuickPick(AGENT_TYPES, {
        placeHolder: 'Select agents to spawn in parallel',
        title: 'oh-my-ag: Parallel Spawn',
        canPickMany: true,
    });
    if (!selected || selected.length === 0) return;

    // Get task description
    const task = await vscode.window.showInputBox({
        prompt: 'Enter the overall task description',
        placeHolder: 'e.g., "Build a user authentication system"',
    });
    if (!task) return;

    const vendor = detectVendor();
    const config = VENDORS[vendor];
    if (!config) return;

    for (const agent of selected) {
        const prompt = `You are a ${agent.value} agent. Task: ${task}`;
        const cmd = `${config.command} ${config.promptFlag} ${JSON.stringify(prompt)}`;
        const terminal = vscode.window.createTerminal({
            name: `🤖 ${agent.label}`,
            cwd: ws.uri.fsPath,
        });
        terminal.sendText(cmd);
    }

    vscode.window.showInformationMessage(`Spawned ${selected.length} agents in parallel via ${vendor}`);
}
