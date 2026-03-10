// ── Agent Verifier ──
// Verifies agent output quality — ported from oh-my-ag's verify.ts

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { VerifyCheck } from '../types';

type AgentType = 'backend' | 'frontend' | 'mobile' | 'qa' | 'debug' | 'pm';

const VALID_AGENTS: AgentType[] = ['backend', 'frontend', 'mobile', 'qa', 'debug', 'pm'];

function check(name: string, status: VerifyCheck['status'], message?: string): VerifyCheck {
    return { name, status, message };
}

function runCmd(cmd: string, cwd: string): string | null {
    try { return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { return null; }
}

function checkSecrets(workspace: string): VerifyCheck {
    const result = runCmd("grep -rn --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' 'password\\s*=\\s*[\"'\'']|api_key\\s*=\\s*[\"'\'']|secret\\s*=\\s*[\"'\'']' . 2>/dev/null | head -5", workspace);
    return result && result.trim()
        ? check('Hardcoded Secrets', 'fail', `Found potential hardcoded secrets:\n${result.trim()}`)
        : check('Hardcoded Secrets', 'pass');
}

function checkTodos(workspace: string): VerifyCheck {
    const result = runCmd("grep -rn --include='*.py' --include='*.ts' --include='*.tsx' --include='*.js' 'TODO\\|FIXME\\|HACK\\|XXX' . 2>/dev/null | wc -l", workspace);
    const count = parseInt(result?.trim() || '0');
    return count > 0
        ? check('TODO Comments', 'warn', `Found ${count} TODO/FIXME comments`)
        : check('TODO Comments', 'pass');
}

function checkPythonSyntax(workspace: string): VerifyCheck {
    const result = runCmd('python3 -m py_compile $(find . -name "*.py" -not -path "*/venv/*" 2>/dev/null | head -20) 2>&1', workspace);
    return (!result || !result.includes('SyntaxError'))
        ? check('Python Syntax', 'pass')
        : check('Python Syntax', 'fail', result.substring(0, 200));
}

function checkTypeScript(workspace: string): VerifyCheck {
    if (!fs.existsSync(path.join(workspace, 'tsconfig.json'))) return check('TypeScript', 'skip', 'No tsconfig.json');
    const result = runCmd('npx tsc --noEmit 2>&1 | head -20', workspace);
    return (!result || !result.includes('error TS'))
        ? check('TypeScript', 'pass')
        : check('TypeScript', 'fail', result.substring(0, 200));
}

function checkFlutterAnalysis(workspace: string): VerifyCheck {
    if (!fs.existsSync(path.join(workspace, 'pubspec.yaml'))) return check('Flutter', 'skip', 'No pubspec.yaml');
    const result = runCmd('flutter analyze 2>&1 | tail -5', workspace);
    return (!result || result.includes('No issues found'))
        ? check('Flutter Analysis', 'pass')
        : check('Flutter Analysis', 'fail', result?.substring(0, 200));
}

function checkPmPlan(workspace: string): VerifyCheck {
    const planDir = path.join(workspace, 'docs', 'plans');
    if (!fs.existsSync(planDir)) return check('PM Plan', 'skip', 'No docs/plans/ directory');
    try {
        const plans = fs.readdirSync(planDir).filter(f => f.endsWith('.md'));
        return plans.length > 0
            ? check('PM Plan', 'pass', `Found ${plans.length} plan(s)`)
            : check('PM Plan', 'warn', 'Plans directory empty');
    } catch { return check('PM Plan', 'skip'); }
}

function runAgentChecks(agentType: AgentType, workspace: string): VerifyCheck[] {
    const checks: VerifyCheck[] = [checkSecrets(workspace), checkTodos(workspace)];
    switch (agentType) {
        case 'backend':
            checks.push(checkPythonSyntax(workspace));
            break;
        case 'frontend':
            checks.push(checkTypeScript(workspace));
            break;
        case 'mobile':
            checks.push(checkFlutterAnalysis(workspace));
            break;
        case 'pm':
            checks.push(checkPmPlan(workspace));
            break;
        default:
            break;
    }
    return checks;
}

/** Command: Verify agent output */
export async function verifyAgentCommand(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { vscode.window.showErrorMessage('No workspace folder open'); return; }

    const pick = await vscode.window.showQuickPick(VALID_AGENTS.map(a => ({ label: a })), {
        placeHolder: 'Select agent type to verify',
        title: 'oh-my-ag: Verify Agent Output',
    });
    if (!pick) return;

    const agentType = pick.label as AgentType;
    const checks = runAgentChecks(agentType, ws.uri.fsPath);

    const outputChannel = vscode.window.createOutputChannel('oh-my-ag Verify');
    outputChannel.clear();
    outputChannel.appendLine(`🔍 Verifying ${agentType} agent output\n`);

    let passed = 0;
    let failed = 0;
    let warned = 0;

    for (const c of checks) {
        const icon = c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : c.status === 'warn' ? '⚠️' : '⏭️';
        outputChannel.appendLine(`${icon} ${c.name}: ${c.status.toUpperCase()}`);
        if (c.message) outputChannel.appendLine(`   ${c.message}`);
        if (c.status === 'pass') passed++;
        else if (c.status === 'fail') failed++;
        else if (c.status === 'warn') warned++;
    }

    outputChannel.appendLine(`\nResults: ${passed} passed, ${failed} failed, ${warned} warnings`);
    outputChannel.show();

    if (failed > 0) {
        vscode.window.showWarningMessage(`Verification: ${failed} check(s) failed. See Output for details.`);
    } else {
        vscode.window.showInformationMessage(`Verification passed! (${warned} warnings)`);
    }
}
