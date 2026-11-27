import type { AgentTaskDto } from './schemas.js';

export interface AgentTasksSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  failed: number;
  skipped: number;
  activeTasks: AgentTaskDto[];
  headlineTask: AgentTaskDto | null;
  otherCount: number;
  overallProgress: number;
  totalRemainingEtaSeconds: number | null;
  hasActiveWork: boolean;
}

/**
 * Computes live remaining ETA seconds from an explicit `estimatedCompletionAt` timestamp
 * or fallback `etaSeconds`, returning `null` if no ETA is set.
 */
export function computeRemainingEtaSeconds(
  eta: { etaSeconds: number | null; estimatedCompletionAt: string | null },
  nowMs = Date.now(),
): number | null {
  if (eta.estimatedCompletionAt) {
    const targetMs = Date.parse(eta.estimatedCompletionAt);
    if (Number.isFinite(targetMs)) {
      return Math.max(0, Math.round((targetMs - nowMs) / 1000));
    }
  }
  if (eta.etaSeconds !== null && Number.isFinite(eta.etaSeconds)) {
    return Math.max(0, Math.round(eta.etaSeconds));
  }
  return null;
}

/**
 * Formats an ETA duration in seconds into a crisp human-readable string (e.g. `45s`, `6m 12s`, `1h 05m`).
 */
export function formatEtaDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const clamped = Math.max(0, Math.round(seconds));
  if (clamped === 0) return '< 1s';
  if (clamped < 60) return `${clamped}s`;
  const hours = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hours > 0) {
    return `${hours}h ${String(mins).padStart(2, '0')}m`;
  }
  return secs > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${mins}m`;
}

/**
 * Computes progress, total remaining ETA, and picks the single headline task for the collapsed
 * CLAUDE LIVE banner (prioritizing in_progress > failed > pending > last completed).
 */
export function summarizeAgentTasks(tasks: AgentTaskDto[], nowMs = Date.now()): AgentTasksSummary {
  const ordered = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);

  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let failed = 0;
  let skipped = 0;

  const activeTasks: AgentTaskDto[] = [];
  let firstFailed: AgentTaskDto | null = null;
  let firstPending: AgentTaskDto | null = null;
  let lastCompleted: AgentTaskDto | null = null;

  let weightedSum = 0;
  let countableTotal = 0;
  let totalRemainingEta = 0;
  let hasAnyEta = false;

  for (const task of ordered) {
    switch (task.status) {
      case 'completed':
        completed += 1;
        countableTotal += 1;
        weightedSum += 100;
        lastCompleted = task;
        break;
      case 'in_progress': {
        inProgress += 1;
        countableTotal += 1;
        weightedSum += task.progress !== null ? Math.max(0, Math.min(100, task.progress)) : 0;
        activeTasks.push(task);
        const rem = computeRemainingEtaSeconds(task, nowMs);
        if (rem !== null) {
          totalRemainingEta += rem;
          hasAnyEta = true;
        }
        break;
      }
      case 'pending': {
        pending += 1;
        countableTotal += 1;
        if (!firstPending) firstPending = task;
        const rem = computeRemainingEtaSeconds(task, nowMs);
        if (rem !== null) {
          totalRemainingEta += rem;
          hasAnyEta = true;
        }
        break;
      }
      case 'failed':
        failed += 1;
        countableTotal += 1;
        if (!firstFailed) firstFailed = task;
        break;
      case 'skipped':
        skipped += 1;
        break;
    }
  }

  const headlineTask =
    activeTasks[0] ?? firstFailed ?? firstPending ?? lastCompleted ?? ordered[0] ?? null;

  const overallProgress =
    countableTotal > 0 ? Math.round(weightedSum / countableTotal) : ordered.length > 0 ? 100 : 0;

  return {
    total: ordered.length,
    completed,
    inProgress,
    pending,
    failed,
    skipped,
    activeTasks,
    headlineTask,
    otherCount: headlineTask ? Math.max(0, ordered.length - 1) : 0,
    overallProgress,
    totalRemainingEtaSeconds: hasAnyEta ? totalRemainingEta : null,
    hasActiveWork: inProgress > 0 || pending > 0,
  };
}
