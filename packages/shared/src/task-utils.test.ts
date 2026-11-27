import { describe, expect, it } from 'vitest';
import type { AgentTaskDto } from './schemas.js';
import { summarizeAgentTasks } from './task-utils.js';

const NOW = '2026-11-27T12:00:00.000Z';

function makeTask(
  idx: number,
  status: AgentTaskDto['status'],
  progress: number | null = null,
): AgentTaskDto {
  return {
    id: `00000000-0000-4000-8000-00000000000${idx}`,
    projectId: '00000000-0000-4000-8000-000000000099',
    externalKey: `step-${idx}`,
    title: `Step ${idx}`,
    detail: '',
    status,
    progress,
    groupName: '',
    assetRef: null,
    sortOrder: idx,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('summarizeAgentTasks', () => {
  it('picks the in_progress task as headline and computes weighted progress', () => {
    const summary = summarizeAgentTasks([
      makeTask(1, 'completed', 100),
      makeTask(2, 'in_progress', 50),
      makeTask(3, 'pending'),
      makeTask(4, 'pending'),
    ]);

    expect(summary.total).toBe(4);
    expect(summary.completed).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.headlineTask?.title).toBe('Step 2');
    expect(summary.otherCount).toBe(3);
    // (100 + 50 + 0 + 0) / 4 = 37.5 -> 38%
    expect(summary.overallProgress).toBe(38);
    expect(summary.hasActiveWork).toBe(true);
  });

  it('ignores skipped tasks in progress calculation and falls back to pending when none in_progress', () => {
    const summary = summarizeAgentTasks([
      makeTask(1, 'completed'),
      makeTask(2, 'skipped'),
      makeTask(3, 'pending'),
    ]);

    expect(summary.headlineTask?.title).toBe('Step 3');
    expect(summary.skipped).toBe(1);
    expect(summary.overallProgress).toBe(50);
    expect(summary.hasActiveWork).toBe(true);
  });

  it('reports 100% and hasActiveWork=false when all tasks are completed', () => {
    const summary = summarizeAgentTasks([
      makeTask(1, 'completed'),
      makeTask(2, 'completed'),
    ]);

    expect(summary.overallProgress).toBe(100);
    expect(summary.hasActiveWork).toBe(false);
    expect(summary.headlineTask?.title).toBe('Step 2');
    expect(summary.otherCount).toBe(1);
  });
});
