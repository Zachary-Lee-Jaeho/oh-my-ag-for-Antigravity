// ── Doctor (Environment Diagnostics) ──
// Checks CLI installations, skills, Serena memory, git config — ported from oh-my-ag's doctor.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { SKILLS_REGISTRY } from './types';

interface CliCheck { name: string; installed: boolean; version?: string }

function checkCli(name: string, command: string): CliCheck {
    try {
        const version = execSync(`${command} --version 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        return { name, installed: true, version };
    } catch { return { name, installed: false }; }
}

/** Command: Run environment diagnostics */
export async function doctorCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath || '';

    const outputChannel = vscode.window.createOutputChannel('oh-my-ag Doctor');
    outputChannel.clear();
    outputChannel.appendLine('🩺 oh-my-ag Doctor\n');

    // 1. CLI installations
    outputChannel.appendLine('── CLI Installation Status ──');
    const clis = [
        checkCli('gemini', 'gemini'),
        checkCli('claude', 'claude'),
        checkCli('codex', 'codex'),
        checkCli('qwen', 'qwen'),
    ];
    for (const cli of clis) {
        const icon = cli.installed ? '✅' : '❌';
        outputChannel.appendLine(`  ${icon} ${cli.name}: ${cli.installed ? cli.version : 'Not installed'}`);
    }

    // 2. Skills check
    outputChannel.appendLine('\n── Skills Status ──');
    if (ws) {
        const skillsDir = path.join(cwd, '.agent', 'skills');
        if (fs.existsSync(skillsDir)) {
            let installed = 0, total = SKILLS_REGISTRY.length;
            for (const skill of SKILLS_REGISTRY) {
                const skillPath = path.join(skillsDir, skill.name);
                const skillMdPath = path.join(skillPath, 'SKILL.md');
                const isInstalled = fs.existsSync(skillPath);
                const hasSkillMd = fs.existsSync(skillMdPath);
                const icon = isInstalled && hasSkillMd ? '✅' : isInstalled ? '⚠️' : '❌';
                outputChannel.appendLine(`  ${icon} ${skill.name}${!hasSkillMd && isInstalled ? ' (missing SKILL.md)' : ''}`);
                if (isInstalled) installed++;
            }
            outputChannel.appendLine(`\n  ${installed}/${total} skills installed`);
        } else {
            outputChannel.appendLine('  ❌ No .agent/skills/ directory found');
            outputChannel.appendLine('  → Run "oh-my-ag: Install Skills" to set up');
        }
    }

    // 3. Workflows check
    outputChannel.appendLine('\n── Workflows Status ──');
    if (ws) {
        const workflowsDir = path.join(cwd, '.agent', 'workflows');
        if (fs.existsSync(workflowsDir)) {
            try {
                const count = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md')).length;
                outputChannel.appendLine(`  ✅ ${count} workflows installed`);
            } catch { outputChannel.appendLine('  ⚠️ Could not read workflows directory'); }
        } else {
            outputChannel.appendLine('  ❌ No .agent/workflows/ directory');
        }

        // Global workflows
        const home = process.env.HOME || process.env.USERPROFILE || '';
        const globalDir = path.join(home, '.gemini', 'antigravity', 'global_workflows');
        if (fs.existsSync(globalDir)) {
            try {
                const count = fs.readdirSync(globalDir).filter(f => f.endsWith('.md')).length;
                outputChannel.appendLine(`  ✅ ${count} global workflows (${globalDir})`);
            } catch { }
        } else {
            outputChannel.appendLine('  ⚠️ No global workflows directory');
        }
    }

    // 4. Serena Memory
    outputChannel.appendLine('\n── Serena Memory ──');
    if (ws) {
        const memoriesDir = path.join(cwd, '.serena', 'memories');
        if (fs.existsSync(memoriesDir)) {
            try {
                const count = fs.readdirSync(memoriesDir).length;
                outputChannel.appendLine(`  ✅ Serena memory directory exists (${count} files)`);
            } catch { outputChannel.appendLine('  ⚠️ Could not read memories'); }
        } else {
            outputChannel.appendLine('  ❌ No .serena/memories/ directory');
            outputChannel.appendLine('  → Run "oh-my-ag: Initialize Serena Memory" to set up');
        }
    }

    // 5. MCP Config
    outputChannel.appendLine('\n── MCP Configuration ──');
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const mcpConfigs: Record<string, string> = {
        gemini: path.join(home, '.gemini', 'settings.json'),
        claude: path.join(home, '.claude.json'),
    };
    for (const [cli, configPath] of Object.entries(mcpConfigs)) {
        if (fs.existsSync(configPath)) {
            try {
                const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                const hasMcp = content.mcpServers || content.mcp;
                outputChannel.appendLine(`  ${hasMcp ? '✅' : '⚠️'} ${cli}: ${hasMcp ? 'MCP configured' : 'No MCP servers'}`);
            } catch { outputChannel.appendLine(`  ⚠️ ${cli}: Could not parse config`); }
        } else {
            outputChannel.appendLine(`  ⏭️ ${cli}: No config file`);
        }
    }

    // 6. Git Config
    outputChannel.appendLine('\n── Git Configuration ──');
    try {
        const rerere = execSync('git config --get rerere.enabled 2>/dev/null || echo ""', { cwd, encoding: 'utf-8' }).trim();
        outputChannel.appendLine(`  ${rerere === 'true' ? '✅' : '⚠️'} git rerere: ${rerere === 'true' ? 'enabled' : 'not enabled (recommended for multi-agent)'}`);
    } catch { outputChannel.appendLine('  ⚠️ git not available'); }

    outputChannel.appendLine('\n── Done ──');
    outputChannel.show();
}
