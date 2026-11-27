import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  ListChecks,
  Loader2,
  MinusCircle,
  Trash2,
} from 'lucide-react';
import {
  computeRemainingEtaSeconds,
  formatEtaDuration,
  summarizeAgentTasks,
  type AgentTaskDto,
  type AgentTaskStatus,
  type JobDto,
} from '@videostudio/shared';

interface ClaudeLiveBarProps {
  runningJobs: JobDto[];
  tasks: AgentTaskDto[];
  onClearTasks: (scope: 'completed' | 'all') => Promise<void>;
  onSelectAssetRef?: (assetRef: string) => void;
}

type TaskFilter = 'all' | 'in_progress' | 'pending' | 'completed';

const TASK_STATUS_LABELS: Record<AgentTaskStatus, string> = {
  in_progress: 'En cours',
  pending: 'À faire',
  completed: 'Terminé',
  failed: 'Échec',
  skipped: 'Ignoré',
};

function TaskStatusIcon({ status }: { status: AgentTaskStatus }) {
  switch (status) {
    case 'in_progress':
      return <Loader2 size={14} className="task-spin" color="var(--status-live)" />;
    case 'completed':
      return <CheckCircle2 size={14} color="var(--status-approved)" />;
    case 'failed':
      return <AlertCircle size={14} color="var(--status-danger)" />;
    case 'skipped':
      return <MinusCircle size={14} color="var(--text-muted)" />;
    case 'pending':
    default:
      return <Circle size={14} color="var(--text-muted)" />;
  }
}

export function ClaudeLiveBar({
  runningJobs,
  tasks,
  onClearTasks,
  onSelectAssetRef,
}: ClaudeLiveBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasAnyEta = useMemo(
    () =>
      runningJobs.some((j) => j.estimatedCompletionAt || j.etaSeconds !== null) ||
      tasks.some(
        (t) =>
          (t.status === 'in_progress' || t.status === 'pending') &&
          (t.estimatedCompletionAt || t.etaSeconds !== null),
      ),
    [runningJobs, tasks],
  );

  // Live 1-second tick whenever an active ETA countdown is visible
  useEffect(() => {
    if (!hasAnyEta) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasAnyEta]);

  const summary = useMemo(() => summarizeAgentTasks(tasks, nowMs), [tasks, nowMs]);

  const visibleTasks = useMemo(() => {
    const ordered = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
    if (filter === 'all') return ordered;
    if (filter === 'completed') {
      return ordered.filter((t) => t.status === 'completed' || t.status === 'skipped');
    }
    return ordered.filter((t) => t.status === filter);
  }, [tasks, filter]);

  if (runningJobs.length === 0 && tasks.length === 0) {
    return null;
  }

  const primaryJob = runningJobs[0] ?? null;
  const headlineTask = summary.headlineTask;
  const isLiveRunning = runningJobs.length > 0 || summary.inProgress > 0;
  const canExpand = tasks.length > 0 || runningJobs.length > 1;

  const primaryJobEtaSec = primaryJob
    ? computeRemainingEtaSeconds(
        {
          etaSeconds: primaryJob.etaSeconds,
          estimatedCompletionAt: primaryJob.estimatedCompletionAt,
        },
        nowMs,
      )
    : null;

  const headlineEtaSec =
    primaryJobEtaSec !== null
      ? primaryJobEtaSec
      : summary.totalRemainingEtaSeconds;

  const headlineEtaLabel =
    headlineEtaSec !== null && isLiveRunning ? formatEtaDuration(headlineEtaSec) : null;

  // Progress bar shown on collapsed row: prefer active job progress, else task progress/overall
  const headlineProgress =
    primaryJob !== null
      ? primaryJob.progress
      : headlineTask?.status === 'in_progress' && headlineTask.progress !== null
        ? headlineTask.progress
        : summary.overallProgress;

  return (
    <div className={`claude-live-panel ${expanded ? 'expanded' : ''}`} role="region" aria-label="Suivi Claude Live">
      {/* Compact 1-line Collapsed Header: shows ONLY what is currently in progress + live ETA */}
      <div
        className={`claude-live-header ${canExpand ? 'clickable' : ''}`}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        aria-expanded={canExpand ? expanded : undefined}
        onClick={() => {
          if (canExpand) setExpanded((v) => !v);
        }}
        onKeyDown={(e) => {
          if (canExpand && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        title={canExpand ? (expanded ? 'Replier la liste des tâches' : 'Cliquer pour voir toutes les tâches') : undefined}
      >
        <div className="claude-live-left">
          <span className={`actor-pill actor-claude ${isLiveRunning ? 'live-pulse' : ''}`}>
            Claude Live
          </span>

          {primaryJob ? (
            <div className="claude-live-headline">
              <span className="claude-live-title">{primaryJob.title}</span>
              {primaryJob.stepTotal !== null && primaryJob.stepCurrent !== null && (
                <span className="claude-live-step-pill">
                  {primaryJob.stepCurrent}/{primaryJob.stepTotal}
                </span>
              )}
              {primaryJob.message && (
                <span className="claude-live-detail">— {primaryJob.message}</span>
              )}
              {!primaryJob.message && headlineTask && (
                <span className="claude-live-subtask" title={headlineTask.detail || headlineTask.title}>
                  <TaskStatusIcon status={headlineTask.status} />
                  <span>{headlineTask.title}</span>
                </span>
              )}
            </div>
          ) : headlineTask ? (
            <div className="claude-live-headline">
              <TaskStatusIcon status={headlineTask.status} />
              <span className="claude-live-title">{headlineTask.title}</span>
              {headlineTask.detail && (
                <span className="claude-live-detail">— {headlineTask.detail}</span>
              )}
            </div>
          ) : null}
        </div>

        <div className="claude-live-right">
          {headlineEtaLabel && (
            <span className="claude-live-eta" title="Temps restant estimé (ETA)">
              <Clock size={12} />
              ETA {headlineEtaLabel}
            </span>
          )}

          <div className="job-progress-bar">
            <div
              className={`job-progress-fill ${
                !isLiveRunning && summary.overallProgress === 100 ? 'done' : ''
              }`}
              style={{ width: `${headlineProgress}%` }}
            />
          </div>
          <span className="claude-live-pct">{headlineProgress}%</span>

          {tasks.length > 0 && (
            <span className="claude-live-counter">
              <ListChecks size={12} />
              {summary.completed}/{summary.total}
              {summary.otherCount > 0 && !expanded && (
                <span className="claude-live-more">· +{summary.otherCount}</span>
              )}
            </span>
          )}

          {canExpand && (
            <span className="claude-live-chevron" aria-hidden="true">
              {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </span>
          )}
        </div>
      </div>

      {/* Expanded Drawer: full ordered task checklist & all running jobs */}
      {expanded && (
        <div className="claude-live-drawer">
          {runningJobs.length > 0 && (
            <div className="claude-live-jobs-box">
              {runningJobs.map((job) => {
                const jobEta = computeRemainingEtaSeconds(
                  {
                    etaSeconds: job.etaSeconds,
                    estimatedCompletionAt: job.estimatedCompletionAt,
                  },
                  nowMs,
                );
                return (
                  <div key={job.id} className="job-row">
                    <Loader2 size={13} className="task-spin" color="var(--status-live)" />
                    <span style={{ fontWeight: 500 }}>{job.title}</span>
                    {job.stepTotal !== null && job.stepCurrent !== null && (
                      <span className="claude-live-step-pill">
                        {job.stepCurrent}/{job.stepTotal}
                      </span>
                    )}
                    {job.message && (
                      <span className="claude-live-detail">{job.message}</span>
                    )}
                    {jobEta !== null && (
                      <span className="claude-live-eta" style={{ marginLeft: 'auto' }}>
                        <Clock size={11} /> {formatEtaDuration(jobEta)}
                      </span>
                    )}
                    <div className="job-progress-bar">
                      <div className="job-progress-fill" style={{ width: `${job.progress}%` }} />
                    </div>
                    <span className="claude-live-pct">{job.progress}%</span>
                  </div>
                );
              })}
            </div>
          )}

          {tasks.length > 0 && (
            <>
              <div className="claude-live-drawer-bar">
                <div className="claude-live-filters">
                  <button
                    type="button"
                    className={`chip ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                  >
                    Toutes ({summary.total})
                  </button>
                  <button
                    type="button"
                    className={`chip ${filter === 'in_progress' ? 'active' : ''}`}
                    onClick={() => setFilter('in_progress')}
                  >
                    En cours ({summary.inProgress})
                  </button>
                  <button
                    type="button"
                    className={`chip ${filter === 'pending' ? 'active' : ''}`}
                    onClick={() => setFilter('pending')}
                  >
                    À faire ({summary.pending})
                  </button>
                  <button
                    type="button"
                    className={`chip ${filter === 'completed' ? 'active' : ''}`}
                    onClick={() => setFilter('completed')}
                  >
                    Terminées ({summary.completed + summary.skipped})
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {summary.completed + summary.skipped > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void onClearTasks('completed')}
                    >
                      Effacer terminées
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    title="Vider la liste des tâches"
                    onClick={() => void onClearTasks('all')}
                  >
                    <Trash2 size={12} /> Vider
                  </button>
                </div>
              </div>

              <div className="claude-live-task-list">
                {visibleTasks.length === 0 ? (
                  <div style={{ padding: '10px 4px', fontSize: 12, color: 'var(--text-muted)' }}>
                    Aucune tâche dans ce filtre.
                  </div>
                ) : (
                  visibleTasks.map((task, idx) => {
                    const prevGroup = idx > 0 ? visibleTasks[idx - 1]?.groupName : '';
                    const showGroupHeader = Boolean(task.groupName && task.groupName !== prevGroup);
                    const taskEtaSec =
                      task.status === 'in_progress' || task.status === 'pending'
                        ? computeRemainingEtaSeconds(
                            {
                              etaSeconds: task.etaSeconds,
                              estimatedCompletionAt: task.estimatedCompletionAt,
                            },
                            nowMs,
                          )
                        : null;

                    return (
                      <div key={task.id}>
                        {showGroupHeader && (
                          <div className="claude-task-group">{task.groupName}</div>
                        )}
                        <div className={`claude-task-row status-${task.status}`}>
                          <div className="claude-task-icon">
                            <TaskStatusIcon status={task.status} />
                          </div>

                          <div className="claude-task-body">
                            <div className="claude-task-title-line">
                              <span className="claude-task-title">{task.title}</span>
                              {task.assetRef && (
                                <button
                                  type="button"
                                  className="ref-copy-btn"
                                  onClick={() => onSelectAssetRef?.(task.assetRef!)}
                                  title={`Ouvrir ${task.assetRef}`}
                                >
                                  {task.assetRef}
                                </button>
                              )}
                            </div>
                            {task.detail && (
                              <div className="claude-task-detail">{task.detail}</div>
                            )}
                          </div>

                          <div className="claude-task-meta">
                            {taskEtaSec !== null && (
                              <span className="claude-live-eta" title="ETA estimée">
                                <Clock size={11} /> {formatEtaDuration(taskEtaSec)}
                              </span>
                            )}
                            {task.status === 'in_progress' && task.progress !== null && (
                              <div className="claude-task-mini-progress">
                                <div className="job-progress-bar" style={{ width: 64 }}>
                                  <div
                                    className="job-progress-fill"
                                    style={{ width: `${task.progress}%` }}
                                  />
                                </div>
                                <span className="claude-live-pct">{task.progress}%</span>
                              </div>
                            )}
                            <span className={`claude-task-badge status-${task.status}`}>
                              {TASK_STATUS_LABELS[task.status]}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
