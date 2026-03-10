// ── Types for oh-my-ag Extension ──

export interface LsConnectionInfo {
    pid: number;
    csrfToken: string;
    port: number;
    certPath: string;
}

export interface ModelQuota {
    label: string;
    modelId: string;
    remainingPercent: number;
    isExhausted: boolean;
    resetTime: Date | null;
    timeUntilReset: string;
    supportsImages: boolean;
}

export interface CreditInfo {
    available: number;
    monthly: number;
    usedPercent: number;
    remainingPercent: number;
}

export interface QuotaSnapshot {
    userName: string;
    email: string;
    planName: string;
    tierName: string;
    promptCredits?: CreditInfo;
    flowCredits?: CreditInfo;
    models: ModelQuota[];
    defaultModel: string | null;
    timestamp: Date;
}

export interface SkillInfo {
    name: string;
    desc: string;
    category: 'domain' | 'coordination' | 'utility' | 'infrastructure';
}

export interface SkillCheck {
    name: string;
    installed: boolean;
    hasSkillMd: boolean;
}

export interface VerifyCheck {
    name: string;
    status: 'pass' | 'fail' | 'warn' | 'skip';
    message?: string;
}

export interface AgentInfo {
    agent: string;
    status: string;
    task: string;
    turn: number | null;
}

export interface SessionInfo {
    id: string;
    status: string;
}

export interface DashboardState {
    session: SessionInfo;
    agents: AgentInfo[];
    activity: { agent: string; message: string; file: string }[];
    memoriesDir: string;
    updatedAt: string;
    phases?: { phase: string; done: boolean }[];
}

export interface Metrics {
    sessions: number;
    skillsUsed: Record<string, number>;
    tasksCompleted: number;
    totalSessionTime: number;
    filesChanged: number;
    linesAdded: number;
    linesRemoved: number;
    lastUpdated: string;
    startDate: string;
    lastSessionId?: string;
    lastSessionStatus?: string;
    lastSessionStarted?: string;
    lastSessionDuration?: number;
}

export interface Retrospective {
    id: string;
    date: string;
    summary: string;
    learnings: string[];
    nextSteps: string[];
    gitCommits: number;
}

export const SKILLS_REGISTRY: SkillInfo[] = [
    // Domain
    { name: 'frontend-agent', desc: 'React/Next.js UI specialist', category: 'domain' },
    { name: 'backend-agent', desc: 'FastAPI/SQLAlchemy API specialist', category: 'domain' },
    { name: 'mobile-agent', desc: 'Flutter cross-platform development', category: 'domain' },
    // Coordination
    { name: 'pm-agent', desc: 'Requirements analysis, task decomposition', category: 'coordination' },
    { name: 'workflow-guide', desc: 'Multi-agent project coordination', category: 'coordination' },
    { name: 'orchestrator', desc: 'CLI-based parallel agent execution', category: 'coordination' },
    // Quality
    { name: 'qa-agent', desc: 'Security, performance, accessibility testing', category: 'utility' },
    { name: 'debug-agent', desc: 'Bug diagnosis and root cause analysis', category: 'utility' },
    { name: 'brainstorm', desc: 'Design-first ideation', category: 'utility' },
    { name: 'commit', desc: 'Conventional Commits with project rules', category: 'utility' },
    // Infrastructure
    { name: 'tf-infra-agent', desc: 'Multi-cloud Terraform provisioning', category: 'infrastructure' },
    { name: 'developer-workflow', desc: 'Monorepo, mise tasks, CI/CD, releases', category: 'infrastructure' },
];
