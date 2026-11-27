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
  hasActiveWork: boolean;
}

/**
 * Computes progress and picks the single headline task for the collapsed
 * CLAUDE LIVE banner (prioritizing in_progress > failed > pending > last completed).
 */
export function summarizeAgentTasks(tasks: AgentTaskDto[]): AgentTasksSummary {
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

  for (const task of ordered) {
    switch (task.status) {
      case 'completed':
        completed += 1;
        countableTotal += 1;
        weightedSum += 100;
        lastCompleted = task;
        break;
      case 'in_progress':
        inProgress += 1;
        countableTotal += 1;
        weightedSum += task.progress !== null ? Math.max(0, Math.min(100, task.progress)) : 0;
        activeTasks.push(task);
        break;
      case 'pending':
        pending += 1;
        countableTotal += 1;
        if (!firstPending) firstPending = task;
        break;
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
    hasActiveWork: inProgress > 0 || pending > 0,
  };
}
