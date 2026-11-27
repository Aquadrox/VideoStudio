import type {
  ActivityDto,
  AnnotationDto,
  AssetDto,
  ComfyWorkflowDto,
  CreateAnnotationInput,
  CreateComfyWorkflowInput,
  CreateProjectInput,
  CreatePromptTemplateInput,
  CreateRulebookInput,
  CreateRuleInput,
  JobDto,
  ProjectDto,
  ProjectRulesBundle,
  PromptTemplateDto,
  RenderedPromptResult,
  RulebookDto,
  RuleDto,
  SkillDto,
  SkillVersionDto,
  UpdateAnnotationInput,
  UpdateAssetInput,
  UpsertProjectRuleOverrideInput,
  UpsertSkillInput,
} from '@videostudio/shared';

export interface HealthResponse {
  status: string;
  version: string;
  services: {
    database: string;
    ffmpeg: string;
    websocketClients: number;
    mcpEndpoint: string;
  };
  timestamp: string;
}

export interface AssetLineage {
  ancestors: AssetDto[];
  children: AssetDto[];
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { error?: string };
      if (errBody.error) message = errBody.error;
    } catch {
      // Ignore non-JSON error
    }
    throw new Error(message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  getHealth(): Promise<HealthResponse> {
    return apiFetch('/api/health');
  },

  async listProjects(): Promise<ProjectDto[]> {
    const res = await apiFetch<{ projects: ProjectDto[] }>('/api/projects');
    return res.projects;
  },

  async createProject(input: CreateProjectInput): Promise<ProjectDto> {
    const res = await apiFetch<{ project: ProjectDto }>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.project;
  },

  async deleteProject(idOrSlug: string): Promise<void> {
    await apiFetch(`/api/projects/${encodeURIComponent(idOrSlug)}`, {
      method: 'DELETE',
    });
  },

  async listAssets(
    projectId: string,
    params?: { type?: string; status?: string; qualityTier?: string; search?: string },
  ): Promise<AssetDto[]> {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    if (params?.qualityTier) qs.set('qualityTier', params.qualityTier);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await apiFetch<{ assets: AssetDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/assets${suffix}`,
    );
    return res.assets;
  },

  async getAssetDetail(assetId: string): Promise<{ asset: AssetDto; lineage: AssetLineage }> {
    return apiFetch(`/api/assets/${encodeURIComponent(assetId)}`);
  },

  async uploadAssetFile(
    projectId: string,
    file: File,
    opts?: { qualityTier?: string; parentRef?: string },
  ): Promise<AssetDto> {
    const form = new FormData();
    form.append('file', file);
    if (opts?.qualityTier) form.append('qualityTier', opts.qualityTier);
    if (opts?.parentRef) form.append('parentRef', opts.parentRef);
    const res = await apiFetch<{ asset: AssetDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/assets`,
      {
        method: 'POST',
        body: form,
      },
    );
    return res.asset;
  },

  async updateAsset(assetId: string, patch: UpdateAssetInput): Promise<AssetDto> {
    const res = await apiFetch<{ asset: AssetDto }>(
      `/api/assets/${encodeURIComponent(assetId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    return res.asset;
  },

  async deleteAsset(assetId: string): Promise<void> {
    await apiFetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
    });
  },

  async listActivities(projectId?: string): Promise<ActivityDto[]> {
    const qs = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    const res = await apiFetch<{ activities: ActivityDto[] }>(`/api/activities${qs}`);
    return res.activities;
  },

  async listJobs(projectId?: string): Promise<JobDto[]> {
    const qs = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    const res = await apiFetch<{ jobs: JobDto[] }>(`/api/jobs${qs}`);
    return res.jobs;
  },

  // --- Stage 2: Annotations & Feedback ---

  async listAssetAnnotations(assetId: string): Promise<AnnotationDto[]> {
    const res = await apiFetch<{ annotations: AnnotationDto[] }>(
      `/api/assets/${encodeURIComponent(assetId)}/annotations`,
    );
    return res.annotations;
  },

  async listProjectFeedback(projectId: string, status: 'open' | 'resolved' | 'all' = 'open'): Promise<AnnotationDto[]> {
    const res = await apiFetch<{ feedback: AnnotationDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/feedback?status=${status}`,
    );
    return res.feedback;
  },

  async createAnnotation(assetId: string, input: CreateAnnotationInput): Promise<AnnotationDto> {
    const res = await apiFetch<{ annotation: AnnotationDto }>(
      `/api/assets/${encodeURIComponent(assetId)}/annotations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.annotation;
  },

  async updateAnnotation(annotationId: string, input: UpdateAnnotationInput): Promise<AnnotationDto> {
    const res = await apiFetch<{ annotation: AnnotationDto }>(
      `/api/annotations/${encodeURIComponent(annotationId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.annotation;
  },

  async deleteAnnotation(annotationId: string): Promise<void> {
    await apiFetch(`/api/annotations/${encodeURIComponent(annotationId)}`, {
      method: 'DELETE',
    });
  },

  // --- Stage 2: Rulebooks & Per-Project Overrides ---

  async listRulebooks(): Promise<RulebookDto[]> {
    const res = await apiFetch<{ rulebooks: RulebookDto[] }>('/api/rulebooks');
    return res.rulebooks;
  },

  async createRulebook(input: CreateRulebookInput): Promise<RulebookDto> {
    const res = await apiFetch<{ rulebook: RulebookDto }>('/api/rulebooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.rulebook;
  },

  async deleteRulebook(rulebookId: string): Promise<void> {
    await apiFetch(`/api/rulebooks/${encodeURIComponent(rulebookId)}`, { method: 'DELETE' });
  },

  async addRuleToRulebook(rulebookId: string, input: CreateRuleInput): Promise<RuleDto> {
    const res = await apiFetch<{ rule: RuleDto }>(
      `/api/rulebooks/${encodeURIComponent(rulebookId)}/rules`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.rule;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await apiFetch(`/api/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
  },

  async getProjectRules(projectId: string): Promise<ProjectRulesBundle> {
    const res = await apiFetch<{ rulesBundle: ProjectRulesBundle }>(
      `/api/projects/${encodeURIComponent(projectId)}/rules`,
    );
    return res.rulesBundle;
  },

  async setProjectRulebooks(projectId: string, rulebookIds: string[]): Promise<ProjectRulesBundle> {
    const res = await apiFetch<{ rulesBundle: ProjectRulesBundle }>(
      `/api/projects/${encodeURIComponent(projectId)}/rulebooks`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rulebookIds }),
      },
    );
    return res.rulesBundle;
  },

  async addProjectCustomRule(projectId: string, input: CreateRuleInput): Promise<RuleDto> {
    const res = await apiFetch<{ rule: RuleDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/rules`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.rule;
  },

  async upsertProjectRuleOverride(
    projectId: string,
    ruleId: string,
    input: UpsertProjectRuleOverrideInput,
  ): Promise<ProjectRulesBundle> {
    const res = await apiFetch<{ rulesBundle: ProjectRulesBundle }>(
      `/api/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}/override`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.rulesBundle;
  },

  async clearProjectRuleOverride(projectId: string, ruleId: string): Promise<ProjectRulesBundle> {
    const res = await apiFetch<{ rulesBundle: ProjectRulesBundle }>(
      `/api/projects/${encodeURIComponent(projectId)}/rules/${encodeURIComponent(ruleId)}/override`,
      { method: 'DELETE' },
    );
    return res.rulesBundle;
  },

  // --- Stage 2: Prompts & ComfyUI Workflows ---

  async listPromptTemplates(): Promise<PromptTemplateDto[]> {
    const res = await apiFetch<{ prompts: PromptTemplateDto[] }>('/api/prompts');
    return res.prompts;
  },

  async createPromptTemplate(input: CreatePromptTemplateInput): Promise<PromptTemplateDto> {
    const res = await apiFetch<{ prompt: PromptTemplateDto }>('/api/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.prompt;
  },

  async deletePromptTemplate(idOrSlug: string): Promise<void> {
    await apiFetch(`/api/prompts/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE' });
  },

  async renderPromptTemplate(
    idOrSlug: string,
    body: { projectIdOrSlug?: string; variables?: Record<string, string>; includeProjectRules?: boolean },
  ): Promise<RenderedPromptResult & { appliedRulesCount: number }> {
    const res = await apiFetch<{ rendered: RenderedPromptResult & { appliedRulesCount: number } }>(
      `/api/prompts/${encodeURIComponent(idOrSlug)}/render`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    return res.rendered;
  },

  async listComfyWorkflows(): Promise<ComfyWorkflowDto[]> {
    const res = await apiFetch<{ workflows: ComfyWorkflowDto[] }>('/api/workflows');
    return res.workflows;
  },

  async createComfyWorkflow(input: CreateComfyWorkflowInput): Promise<ComfyWorkflowDto> {
    const res = await apiFetch<{ workflow: ComfyWorkflowDto }>('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.workflow;
  },

  async deleteComfyWorkflow(idOrSlug: string): Promise<void> {
    await apiFetch(`/api/workflows/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE' });
  },

  // --- Stage 2: Claude Code Skills Hub ---

  async listSkills(projectId?: string): Promise<SkillDto[]> {
    const qs = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    const res = await apiFetch<{ skills: SkillDto[] }>(`/api/skills${qs}`);
    return res.skills;
  },

  async getSkillDetail(idOrSlug: string): Promise<{ skill: SkillDto; versions: SkillVersionDto[] }> {
    return apiFetch(`/api/skills/${encodeURIComponent(idOrSlug)}`);
  },

  async upsertSkill(input: UpsertSkillInput): Promise<SkillDto> {
    const res = await apiFetch<{ skill: SkillDto }>('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.skill;
  },

  async deleteSkill(idOrSlug: string): Promise<void> {
    await apiFetch(`/api/skills/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE' });
  },
};
