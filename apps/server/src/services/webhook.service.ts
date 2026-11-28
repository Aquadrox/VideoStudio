import crypto from 'node:crypto';
import { desc, eq, isNull, or } from 'drizzle-orm';
import type {
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookDto,
  WebhookEventType,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { Database } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { assertSafeFetchUrl } from '../utils/security.js';

export interface WebhookDeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

export function signWebhookPayload(body: string, secret: string): string {
  const digest = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listWebhooks(projectId?: string): Promise<WebhookDto[]> {
    const rows = projectId
      ? await this.db
          .select()
          .from(webhooks)
          .where(or(eq(webhooks.projectId, projectId), isNull(webhooks.projectId)))
          .orderBy(desc(webhooks.createdAt))
      : await this.db.select().from(webhooks).orderBy(desc(webhooks.createdAt));

    return rows.map((row) => this.toDto(row));
  }

  async getWebhookById(id: string): Promise<typeof webhooks.$inferSelect | null> {
    const [row] = await this.db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1);
    return row ?? null;
  }

  async createWebhook(input: CreateWebhookInput): Promise<WebhookDto> {
    assertSafeFetchUrl(input.url, this.config.allowedFetchHosts);

    const [created] = await this.db
      .insert(webhooks)
      .values({
        projectId: input.projectId ?? null,
        name: input.name,
        url: input.url,
        events: input.events,
        secret: input.secret && input.secret.trim().length > 0 ? input.secret.trim() : null,
        enabled: input.enabled ?? true,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create webhook');
    }

    return this.toDto(created);
  }

  async updateWebhook(id: string, input: UpdateWebhookInput): Promise<WebhookDto | null> {
    const existing = await this.getWebhookById(id);
    if (!existing) return null;

    if (input.url !== undefined) {
      assertSafeFetchUrl(input.url, this.config.allowedFetchHosts);
    }

    const nextSecret =
      input.secret === undefined
        ? existing.secret
        : input.secret === null || input.secret.trim().length === 0
          ? null
          : input.secret.trim();

    const [updated] = await this.db
      .update(webhooks)
      .set({
        name: input.name ?? existing.name,
        url: input.url ?? existing.url,
        events: input.events ?? existing.events,
        secret: nextSecret,
        enabled: input.enabled ?? existing.enabled,
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, id))
      .returning();

    return updated ? this.toDto(updated) : null;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(webhooks)
      .where(eq(webhooks.id, id))
      .returning({ id: webhooks.id });
    return deleted.length > 0;
  }

  async testWebhook(id: string): Promise<{
    ok: boolean;
    statusCode: number | null;
    error: string | null;
    webhook: WebhookDto;
  } | null> {
    const row = await this.getWebhookById(id);
    if (!row) return null;

    const eventName = (row.events[0] as WebhookEventType | undefined) ?? 'asset.created';
    const result = await this.deliverToTarget(row, eventName, row.projectId, {
      test: true,
      message: 'VideoStudio webhook connectivity test',
    });

    const refreshed = (await this.getWebhookById(id)) ?? row;
    return {
      ...result,
      webhook: this.toDto(refreshed),
    };
  }

  /**
   * Non-blocking event dispatch to all enabled matching webhooks.
   * Never throws into the calling business logic.
   */
  emit(
    event: WebhookEventType,
    projectId: string | null,
    data: Record<string, unknown>,
  ): void {
    void this.dispatchEvent(event, projectId, data).catch(() => {
      // Delivery failures are persisted per-webhook and must never disrupt core requests
    });
  }

  async dispatchEvent(
    event: WebhookEventType,
    projectId: string | null,
    data: Record<string, unknown>,
  ): Promise<number> {
    const candidates = projectId
      ? await this.db
          .select()
          .from(webhooks)
          .where(or(eq(webhooks.projectId, projectId), isNull(webhooks.projectId)))
      : await this.db.select().from(webhooks).where(isNull(webhooks.projectId));

    const matching = candidates.filter(
      (w) => w.enabled && Array.isArray(w.events) && w.events.includes(event),
    );

    if (matching.length === 0) return 0;

    await Promise.allSettled(
      matching.map((target) => this.deliverToTarget(target, event, projectId, data)),
    );

    return matching.length;
  }

  private async deliverToTarget(
    target: typeof webhooks.$inferSelect,
    event: WebhookEventType,
    projectId: string | null,
    data: Record<string, unknown>,
  ): Promise<WebhookDeliveryResult> {
    const triggeredAt = new Date();
    const body = JSON.stringify({
      event,
      timestamp: triggeredAt.toISOString(),
      projectId,
      data,
    });

    let statusCode: number | null = null;
    let errorMessage: string | null = null;
    let ok = false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const parsed = assertSafeFetchUrl(target.url, this.config.allowedFetchHosts);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'VideoStudio-Webhook/0.10.0',
        'X-VideoStudio-Event': event,
      };
      if (target.secret) {
        headers['X-VideoStudio-Signature'] = signWebhookPayload(body, target.secret);
      }

      const response = await this.fetchImpl(parsed.toString(), {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      statusCode = response.status;
      ok = response.ok;
      if (!response.ok) {
        errorMessage = `HTTP ${response.status} ${response.statusText}`.trim();
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Webhook delivery failed';
      ok = false;
    } finally {
      clearTimeout(timeout);
    }

    try {
      await this.db
        .update(webhooks)
        .set({
          lastStatusCode: statusCode,
          lastTriggeredAt: triggeredAt,
          lastError: errorMessage,
          updatedAt: triggeredAt,
        })
        .where(eq(webhooks.id, target.id));
    } catch {
      // Ignore DB status update failure if webhook was deleted concurrently
    }

    return { ok, statusCode, error: errorMessage };
  }

  private toDto(row: typeof webhooks.$inferSelect): WebhookDto {
    return {
      id: row.id,
      projectId: row.projectId ?? null,
      name: row.name,
      url: row.url,
      events: (row.events ?? []) as WebhookEventType[],
      hasSecret: Boolean(row.secret && row.secret.length > 0),
      enabled: row.enabled,
      lastStatusCode: row.lastStatusCode ?? null,
      lastTriggeredAt: row.lastTriggeredAt ? row.lastTriggeredAt.toISOString() : null,
      lastError: row.lastError ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
