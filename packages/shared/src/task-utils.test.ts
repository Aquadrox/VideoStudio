import { describe, expect, it } from 'vitest';
import type { AgentTaskDto } from './schemas.js';
import {
  computeRemainingEtaSeconds,
  formatEtaDuration,
  summarizeAgentTasks,
} from './task-utils.js';

const NOW = '2026-11-27T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function makeTask(
  idx: number,
  status: AgentTaskDto['status'],
  progress: number | null = null,
  etaSeconds: number | null = null,
  estimatedCompletionAt: string | null = null,
): AgentTaskDto {
  return {
    id: `00000000-0000-4000-8000-00000000000${idx}`,
    projectId: '00000000-0000-4000-8000-000000000099',
    externalKey: `step-${idx}`,
    title: `Step ${idx}`,
    detail: '',
    status,
    progress,
    etaSeconds,
    estimatedCompletionAt,
    groupName: '',
    assetRef: null,
    sortOrder: idx,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('summarizeAgentTasks & ETA helpers', () => {
  it('picks the in_progress task as headline and computes weighted progress + remaining ETA', () => {
    const summary = summarizeAgentTasks(
      [
        makeTask(1, 'completed', 100, 60),
        makeTask(2, 'in_progress', 50, 120, '2026-11-27T12:01:30.000Z'), // 90s remaining from NOW
        makeTask(3, 'pending', null, 180),
        makeTask(4, 'pending'),
      ],
      NOW_MS,
    );

    expect(summary.total).toBe(4);
    expect(summary.completed).toBe(1);
    expect(summary.inProgress).toBe(1);
    expect(summary.pending).toBe(2);
    expect(summary.headlineTask?.title).toBe('Step 2');
    expect(summary.otherCount).toBe(3);
    expect(summary.overallProgress).toBe(38);
    expect(summary.totalRemainingEtaSeconds).toBe(270); // 90s + 180s
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
    expect(summary.totalRemainingEtaSeconds).toBeNull();
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

  it('computes and formats ETA durations cleanly', () => {
    expect(
      computeRemainingEtaSeconds(
        { etaSeconds: 120, estimatedCompletionAt: '2026-11-27T12:00:45.000Z' },
        NOW_MS,
      ),
    ).toBe(45);
    expect(formatEtaDuration(0)).toBe('< 1s');
    expect(formatEtaDuration(45)).toBe('45s');
    expect(formatEtaDuration(125)).toBe('2m 05s');
    expect(formatEtaDuration(3900)).toBe('1h 05m');
    expect(formatEtaDuration(null)).toBeNull();
  });
});
