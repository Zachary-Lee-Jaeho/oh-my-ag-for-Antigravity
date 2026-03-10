// ── Serena Memory Initializer ──

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const SCHEMA_FILES: Record<string, string> = {
    'orchestrator-session.md': `# Session: {session-id}\n\n## Status: PENDING\n\n## Configuration\n- Max Parallel: 3\n- Max Retries: 2\n\n## Timeline\n`,
    'task-board.md': `# Task Board\n\n| Agent | Status | Task |\n|-------|--------|------|\n`,
    'lessons-learned.md': `# Lessons Learned\n\n## Entries\n`,
    'session-metrics.md': `# Session Metrics\n\n## Events\n\n| Timestamp | Type | Score | Description |\n|-----------|------|-------|-------------|\n`,
};

/** Command: Initialize Serena Memory schema */
export async function memoryInitCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showErrorMessage('No workspace folder open'); return; }

    const memoriesDir = path.join(ws.uri.fsPath, '.serena', 'memories');
    fs.mkdirSync(memoriesDir, { recursive: true });

    let created = 0;
    for (const [filename, content] of Object.entries(SCHEMA_FILES)) {
        const filePath = path.join(memoriesDir, filename);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, content, 'utf-8');
            created++;
        }
    }

    // Create .gitkeep
    const gitkeep = path.join(memoriesDir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');

    vscode.window.showInformationMessage(
        `oh-my-ag: Serena Memory initialized (${created} schema files created in .serena/memories/)`
    );
}
