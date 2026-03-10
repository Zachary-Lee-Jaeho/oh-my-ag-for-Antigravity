// ── Cleanup Command ──
// Cleans up orphaned subagent processes and temporary files.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

/** Command: Cleanup orphaned processes and temp files */
export async function cleanupCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = ws?.uri.fsPath || '';

    const outputChannel = vscode.window.createOutputChannel('oh-my-ag Cleanup');
    outputChannel.clear();
    outputChannel.appendLine('🧹 oh-my-ag Cleanup\n');

    let issues = 0;

    // 1. Find orphaned gemini/claude/codex processes
    outputChannel.appendLine('── Checking for orphaned agent processes ──');
    const agents = ['gemini', 'claude', 'codex', 'qwen'];
    for (const agent of agents) {
        try {
            const pids = execSync(`pgrep -f "${agent}" 2>/dev/null || echo ""`, { encoding: 'utf-8' }).trim();
            if (pids) {
                const pidList = pids.split('\n').filter(Boolean);
                outputChannel.appendLine(`  ⚠️ Found ${pidList.length} ${agent} process(es): ${pidList.join(', ')}`);
                issues += pidList.length;
            }
        } catch { /* no processes */ }
    }

    if (issues === 0) {
        outputChannel.appendLine('  ✅ No orphaned agent processes found');
    }

    // 2. Check temp files
    outputChannel.appendLine('\n── Checking temporary files ──');
    if (ws) {
        const tmpDir = path.join(cwd, '.serena', 'tmp');
        if (fs.existsSync(tmpDir)) {
            try {
                const files = fs.readdirSync(tmpDir);
                if (files.length > 0) {
                    outputChannel.appendLine(`  ⚠️ Found ${files.length} temp file(s) in .serena/tmp/`);
                    issues += files.length;
                } else {
                    outputChannel.appendLine('  ✅ No temp files');
                }
            } catch { }
        }

        // 3. Check progress files without active processes
        const memoriesDir = path.join(cwd, '.serena', 'memories');
        if (fs.existsSync(memoriesDir)) {
            const progressFiles = fs.readdirSync(memoriesDir).filter(f => f.startsWith('progress-'));
            if (progressFiles.length > 0) {
                outputChannel.appendLine(`\n── Stale progress files ──`);
                outputChannel.appendLine(`  Found ${progressFiles.length} progress file(s)`);
                for (const f of progressFiles) {
                    outputChannel.appendLine(`  • ${f}`);
                }
            }
        }
    }

    // Ask to clean if issues found
    if (issues > 0) {
        const choice = await vscode.window.showWarningMessage(
            `Found ${issues} cleanup items. Clean up?`,
            'Clean Up', 'Cancel'
        );

        if (choice === 'Clean Up') {
            // Kill orphaned processes
            for (const agent of agents) {
                try { execSync(`pkill -f "${agent}" 2>/dev/null || true`, { encoding: 'utf-8' }); } catch { }
            }

            // Clean temp files
            if (ws) {
                const tmpDir = path.join(cwd, '.serena', 'tmp');
                if (fs.existsSync(tmpDir)) {
                    try { fs.rmSync(tmpDir, { recursive: true }); } catch { }
                }
            }

            outputChannel.appendLine('\n✅ Cleanup complete');
            vscode.window.showInformationMessage('oh-my-ag: Cleanup complete');
        }
    } else {
        outputChannel.appendLine('\n✅ Nothing to clean up');
    }

    outputChannel.show();
}
