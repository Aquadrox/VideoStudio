import type { ActivityDto } from '@videostudio/shared';
import { formatRelativeTime } from '../utils/format';

interface ActivityFeedProps {
  activities: ActivityDto[];
  onSelectEntityId: (entityId: string) => void;
}

export function ActivityFeed({ activities, onSelectEntityId }: ActivityFeedProps) {
  if (activities.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 32 }}>
        <h2>Flux Live Claude Code</h2>
        <p>
          Aucune activité enregistrée pour le moment. Dès que Claude Code appellera un outil
          MCP, ses créations et mises à jour apparaîtront ici en temps réel.
        </p>
      </div>
    );
  }

  return (
    <div className="activity-list">
      {activities.map((item) => (
        <div key={item.id} className="activity-item">
          <div className="activity-header">
            <span className={`actor-pill actor-${item.actor}`}>{item.actor}</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {formatRelativeTime(item.createdAt)}
            </span>
          </div>

          <div className="activity-summary">{item.summary}</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {item.entityRef && item.entityType === 'asset' && item.entityId ? (
              <button
                type="button"
                className="ref-copy-btn"
                onClick={() => onSelectEntityId(item.entityId!)}
              >
                Ouvrir {item.entityRef}
              </button>
            ) : item.entityRef ? (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                {item.entityRef}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
