import type {
  ActivityDto,
  AgentTaskDto,
  AnnotationDto,
  AssetDto,
  AudioTrackDto,
  BibleEntityDto,
  ComfyWorkflowDto,
  CommitProjectRepoInput,
  ConfigureProjectRepoInput,
  CreateAnnotationInput,
  CreateComfyWorkflowInput,
  CreateProjectInput,
  CreatePromptTemplateInput,
  CreateRulebookInput,
  CreateRuleInput,
  CreateSceneInput,
  CreateShotInput,
  JobDto,
  MediaFolderDto,
  ProjectDto,
  ProjectRepoStatusDto,
  ProjectRulesBundle,
  ProjectScriptDto,
  PromptTemplateDto,
  RenderedPromptResult,
  RulebookDto,
  RuleDto,
  SceneDto,
  ShotDto,
  SkillDto,
  SkillVersionDto,
  UpdateAnnotationInput,
  UpdateAssetInput,
  UpdateProjectInput,
  UpdateRuleInput,
  UpdateScriptInput,
  UpdateShotInput,
  UpdateYouTubePackageInput,
  UpsertAudioTrackInput,
  UpsertBibleEntityInput,
  UpsertProjectRuleOverrideInput,
  UpsertSkillInput,
  YouTubePackageDto,
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

  async updateProject(idOrSlug: string, input: UpdateProjectInput): Promise<ProjectDto> {
    const res = await apiFetch<{ project: ProjectDto }>(
      `/api/projects/${encodeURIComponent(idOrSlug)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.project;
  },

  async deleteProject(idOrSlug: string): Promise<void> {
    await apiFetch(`/api/projects/${encodeURIComponent(idOrSlug)}`, {
      method: 'DELETE',
    });
  },

  async listMediaFolders(projectId: string): Promise<MediaFolderDto[]> {
    const res = await apiFetch<{ folders: MediaFolderDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/folders`,
    );
    return res.folders;
  },

  async createMediaFolder(projectId: string, path: string): Promise<MediaFolderDto> {
    const res = await apiFetch<{ folder: MediaFolderDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/folders`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      },
    );
    return res.folder;
  },

  async deleteMediaFolder(projectId: string, path: string): Promise<void> {
    await apiFetch(
      `/api/projects/${encodeURIComponent(projectId)}/folders?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    );
  },

  async listAssets(
    projectId: string,
    params?: {
      type?: string;
      status?: string;
      qualityTier?: string;
      folderPath?: string;
      recursive?: boolean;
      search?: string;
    },
  ): Promise<AssetDto[]> {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    if (params?.qualityTier) qs.set('qualityTier', params.qualityTier);
    if (params?.folderPath !== undefined) qs.set('folderPath', params.folderPath);
    if (params?.recursive) qs.set('recursive', 'true');
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
    opts?: { qualityTier?: string; parentRef?: string; folderPath?: string },
  ): Promise<AssetDto> {
    const form = new FormData();
    form.append('file', file);
    if (opts?.qualityTier) form.append('qualityTier', opts.qualityTier);
    if (opts?.parentRef) form.append('parentRef', opts.parentRef);
    if (opts?.folderPath) form.append('folderPath', opts.folderPath);
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

  async listAgentTasks(projectId: string): Promise<AgentTaskDto[]> {
    const res = await apiFetch<{ tasks: AgentTaskDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks`,
    );
    return res.tasks;
  },

  async clearAgentTasks(
    projectId: string,
    scope: 'completed' | 'all' = 'completed',
  ): Promise<AgentTaskDto[]> {
    const res = await apiFetch<{ tasks: AgentTaskDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/tasks?scope=${scope}`,
      { method: 'DELETE' },
    );
    return res.tasks;
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

  async updateRule(ruleId: string, input: UpdateRuleInput): Promise<RuleDto> {
    const res = await apiFetch<{ rule: RuleDto }>(
      `/api/rules/${encodeURIComponent(ruleId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.rule;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await apiFetch(`/api/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
  },

  async getProjectRules(projectId: string, tags?: string[]): Promise<ProjectRulesBundle> {
    const qs = tags && tags.length > 0 ? `?tags=${encodeURIComponent(tags.join(','))}` : '';
    const res = await apiFetch<{ rulesBundle: ProjectRulesBundle }>(
      `/api/projects/${encodeURIComponent(projectId)}/rules${qs}`,
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
    body: {
      projectIdOrSlug?: string;
      variables?: Record<string, string>;
      includeProjectRules?: boolean;
      tags?: string[];
    },
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

  // --- Stage 3: Pre-production (Script, Bible, Storyboard) ---

  async getProjectScript(projectId: string): Promise<ProjectScriptDto> {
    const res = await apiFetch<{ script: ProjectScriptDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/script`,
    );
    return res.script;
  },

  async updateProjectScript(
    projectId: string,
    input: UpdateScriptInput,
  ): Promise<ProjectScriptDto> {
    const res = await apiFetch<{ script: ProjectScriptDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/script`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.script;
  },

  async listBibleEntities(projectId: string): Promise<BibleEntityDto[]> {
    const res = await apiFetch<{ entities: BibleEntityDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/bible`,
    );
    return res.entities;
  },

  async upsertBibleEntity(
    projectId: string,
    input: UpsertBibleEntityInput,
  ): Promise<BibleEntityDto> {
    const res = await apiFetch<{ entity: BibleEntityDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/bible`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.entity;
  },

  async deleteBibleEntity(entityId: string): Promise<void> {
    await apiFetch(`/api/bible/${encodeURIComponent(entityId)}`, { method: 'DELETE' });
  },

  async getStoryboard(projectId: string): Promise<SceneDto[]> {
    const res = await apiFetch<{ scenes: SceneDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/storyboard`,
    );
    return res.scenes;
  },

  async createScene(projectId: string, input: CreateSceneInput): Promise<SceneDto> {
    const res = await apiFetch<{ scene: SceneDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/scenes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.scene;
  },

  async deleteScene(sceneId: string): Promise<void> {
    await apiFetch(`/api/scenes/${encodeURIComponent(sceneId)}`, { method: 'DELETE' });
  },

  async createShot(projectId: string, input: CreateShotInput): Promise<ShotDto> {
    const res = await apiFetch<{ shot: ShotDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/shots`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.shot;
  },

  async updateShot(shotId: string, input: UpdateShotInput): Promise<ShotDto> {
    const res = await apiFetch<{ shot: ShotDto }>(
      `/api/shots/${encodeURIComponent(shotId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.shot;
  },

  async deleteShot(shotId: string): Promise<void> {
    await apiFetch(`/api/shots/${encodeURIComponent(shotId)}`, { method: 'DELETE' });
  },

  // --- Stage 3: Audio, Music & Lyrics ---

  async listAudioTracks(projectId: string): Promise<AudioTrackDto[]> {
    const res = await apiFetch<{ tracks: AudioTrackDto[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/audio`,
    );
    return res.tracks;
  },

  async upsertAudioTrack(
    projectId: string,
    input: UpsertAudioTrackInput,
  ): Promise<AudioTrackDto> {
    const res = await apiFetch<{ track: AudioTrackDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/audio`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.track;
  },

  async deleteAudioTrack(trackId: string): Promise<void> {
    await apiFetch(`/api/audio/${encodeURIComponent(trackId)}`, { method: 'DELETE' });
  },

  // --- Stage 3: YouTube Packaging Hub ---

  async getYouTubePackage(projectId: string): Promise<YouTubePackageDto> {
    const res = await apiFetch<{ youtube: YouTubePackageDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/youtube`,
    );
    return res.youtube;
  },

  async updateYouTubePackage(
    projectId: string,
    input: UpdateYouTubePackageInput,
  ): Promise<YouTubePackageDto> {
    const res = await apiFetch<{ youtube: YouTubePackageDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/youtube`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.youtube;
  },

  async exportYouTubePack(
    projectId: string,
  ): Promise<{ exportDir: string; files: string[]; warnings: string[] }> {
    const res = await apiFetch<{
      exportPack: { exportDir: string; files: string[]; warnings: string[] };
    }>(`/api/projects/${encodeURIComponent(projectId)}/youtube/export-pack`, {
      method: 'POST',
    });
    return res.exportPack;
  },

  // --- Stage 3 / Issue #4: Per-Project Local Git & GitHub ---

  async getProjectGitStatus(projectId: string): Promise<ProjectRepoStatusDto> {
    const res = await apiFetch<{ git: ProjectRepoStatusDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/git`,
    );
    return res.git;
  },

  async initOrConfigureProjectGit(
    projectId: string,
    input: ConfigureProjectRepoInput,
  ): Promise<ProjectRepoStatusDto> {
    const res = await apiFetch<{ git: ProjectRepoStatusDto }>(
      `/api/projects/${encodeURIComponent(projectId)}/git/init`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return res.git;
  },

  async commitProjectGit(
    projectId: string,
    input: CommitProjectRepoInput,
  ): Promise<{ status: ProjectRepoStatusDto; committed: boolean; sha: string | null }> {
    return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/git/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  },

  async pushProjectGit(
    projectId: string,
  ): Promise<{ ok: boolean; output: string; status: ProjectRepoStatusDto }> {
    return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/git/push`, {
      method: 'POST',
    });
  },
};
