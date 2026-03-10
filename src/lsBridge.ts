// ── Language Server Bridge ──
// Discovers and communicates with the Antigravity Language Server.
// Pattern replicated from Chat Copy lsClient.ts (independent copy, no shared code).

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as os from 'os';
import { LsConnectionInfo, QuotaSnapshot, ModelQuota, CreditInfo } from './types';

// ── Discovery ──

export function findExtensionPath(): string | null {
    const base = path.join(os.homedir(), '.antigravity-server', 'bin');
    if (!fs.existsSync(base)) return null;
    const ver = fs.readdirSync(base)
        .filter(d => fs.existsSync(path.join(base, d, 'extensions', 'antigravity')))
        .sort().reverse()[0];
    return ver ? path.join(base, ver, 'extensions', 'antigravity') : null;
}

function argValue(args: string[], flag: string): string | null {
    const i = args.indexOf(flag);
    return (i >= 0 && i + 1 < args.length) ? args[i + 1] : null;
}

function getListeningPorts(pid: number): number[] {
    const inodes = new Set<string>();
    try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
            try {
                const link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
                const m = /^socket:\[(\d+)\]$/.exec(link);
                if (m) inodes.add(m[1]);
            } catch { /* skip */ }
        }
    } catch { return []; }
    if (!inodes.size) return [];

    const ports: number[] = [];
    const LOOPBACK = new Set([
        '0100007F', '00000000',
        '00000000000000000000000001000000', '00000000000000000000000000000000'
    ]);
    for (const tcpFile of ['/proc/net/tcp', '/proc/net/tcp6']) {
        try {
            for (const line of fs.readFileSync(tcpFile, 'utf8').split('\n').slice(1)) {
                const p = line.trim().split(/\s+/);
                if (p.length < 10 || p[3] !== '0A' || !inodes.has(p[9])) continue;
                const [addr, portHex] = p[1].split(':');
                if (LOOPBACK.has(addr)) ports.push(parseInt(portHex, 16));
            }
        } catch { /* skip */ }
    }
    return ports;
}

// ── Connection ──

export async function connectToLs(allowInsecure: boolean): Promise<LsConnectionInfo> {
    if (process.platform !== 'linux') {
        throw new Error('Linux only (for now).');
    }

    const uid = process.getuid?.();

    // Scan /proc for ANY running language_server_linux_x64 owned by current user
    for (const pidStr of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
        // Check ownership
        if (uid != null) {
            try {
                const stat = fs.statSync(`/proc/${pidStr}`);
                if (stat.uid !== uid) continue;
            } catch { continue; }
        }

        let cmdline: string;
        try { cmdline = fs.readFileSync(`/proc/${pidStr}/cmdline`, 'utf8'); } catch { continue; }
        if (!cmdline.includes('language_server_linux_x64')) continue;

        const args = cmdline.split('\0').filter(Boolean);
        const csrfToken = argValue(args, '--csrf_token');
        if (!csrfToken) continue;

        // Derive cert.pem path from the actual binary path
        const binaryPath = args[0] || '';
        // binary is at .../<version>/extensions/antigravity/bin/language_server_linux_x64
        // cert is at  .../<version>/extensions/antigravity/dist/languageServer/cert.pem
        const extDir = path.dirname(path.dirname(binaryPath)); // up from bin/ → extensions/antigravity/
        const certPath = path.join(extDir, 'dist', 'languageServer', 'cert.pem');

        const pid = parseInt(pidStr, 10);
        const ports = getListeningPorts(pid);

        for (const port of ports) {
            const info: LsConnectionInfo = { pid, csrfToken, port, certPath };
            try {
                await callLsApi(info, 'Heartbeat', { metadata: {} }, allowInsecure);
                return info;
            } catch { /* try next port */ }
        }
    }
    throw new Error('Could not find Antigravity Language Server. Is Antigravity running?');
}

// ── RPC Calls ──

export function callLsApi(
    info: LsConnectionInfo, method: string, body: object, allowInsecure = false
): Promise<any> {
    return new Promise((resolve, reject) => {
        const doRequest = (rejectUnauth: boolean) => {
            const agentOpts: https.AgentOptions = { rejectUnauthorized: rejectUnauth };
            if (rejectUnauth) {
                try { agentOpts.ca = fs.readFileSync(info.certPath); } catch {
                    if (!allowInsecure) return reject(new Error(`cert.pem not found: ${info.certPath}`));
                    return doRequest(false);
                }
            }
            const postData = JSON.stringify(body);
            const req = https.request({
                hostname: '127.0.0.1', port: info.port, method: 'POST',
                path: `/exa.language_server_pb.LanguageServerService/${method}`,
                agent: new https.Agent(agentOpts),
                headers: {
                    'Content-Type': 'application/json',
                    'x-codeium-csrf-token': info.csrfToken,
                    'Content-Length': Buffer.byteLength(postData),
                },
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    try {
                        const j = JSON.parse(data);
                        (j.code && j.code !== 'ok') ? reject(new Error(`LS: ${j.code} - ${j.message}`)) : resolve(j);
                    } catch { reject(new Error(`Bad LS response: ${data.substring(0, 200)}`)); }
                });
            });
            req.on('error', err => {
                if (rejectUnauth && allowInsecure) doRequest(false);
                else reject(err);
            });
            req.write(postData);
            req.end();
        };
        doRequest(true);
    });
}

// ── Quota Parsing (from LS GetUserStatus RPC) ──

function formatTimeUntilReset(ms: number): string {
    if (ms <= 0) return 'Ready';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function calcCredits(monthly: number | undefined, available: number | undefined): CreditInfo | undefined {
    if (!monthly || monthly <= 0) return undefined;
    const avail = available ?? 0;
    const used = monthly - avail;
    return {
        available: avail,
        monthly,
        usedPercent: Math.round((used / monthly) * 100),
        remainingPercent: Math.round((avail / monthly) * 100),
    };
}

export function parseQuota(data: any): QuotaSnapshot {
    const us = data?.userStatus ?? data ?? {};
    const planStatus = us?.planStatus ?? {};
    const planInfo = planStatus?.planInfo ?? {};

    const models: ModelQuota[] = (us?.clientModelConfigs ?? []).map((cfg: any) => {
        const qi = cfg?.quotaInfo ?? {};
        const remaining = qi?.remainingFraction != null ? qi.remainingFraction * 100 : 100;
        const resetMs = qi?.resetTime ? new Date(qi.resetTime).getTime() - Date.now() : 0;
        return {
            label: cfg?.label ?? cfg?.modelOrAlias?.model ?? cfg?.model ?? 'Unknown',
            modelId: cfg?.modelOrAlias?.model ?? cfg?.model ?? '',
            remainingPercent: Math.max(0, Math.min(100, remaining)),
            isExhausted: qi?.allowed === false || remaining <= 0,
            resetTime: qi?.resetTime ? new Date(qi.resetTime) : null,
            timeUntilReset: resetMs > 0 ? formatTimeUntilReset(resetMs) : 'Ready',
            supportsImages: cfg?.supportsImages ?? false,
        };
    });

    const defModel = us?.defaultOverrideModelConfig?.modelOrAlias?.model
        ?? us?.modelOrAlias?.model ?? us?.model ?? null;

    return {
        userName: us?.name ?? 'Unknown',
        email: us?.email ?? '',
        planName: planInfo?.planName ?? 'Unknown',
        tierName: us?.userTier?.name ?? '',
        promptCredits: calcCredits(planInfo?.monthlyPromptCredits, planStatus?.availablePromptCredits),
        flowCredits: calcCredits(planInfo?.monthlyFlowCredits, planStatus?.availableFlowCredits),
        models,
        defaultModel: defModel,
        timestamp: new Date(),
    };
}

export async function fetchQuota(allowInsecure: boolean): Promise<QuotaSnapshot | null> {
    try {
        const conn = await connectToLs(allowInsecure);
        const data = await callLsApi(conn, 'GetUserStatus', { metadata: {} }, allowInsecure);
        return parseQuota(data);
    } catch {
        return null;
    }
}
