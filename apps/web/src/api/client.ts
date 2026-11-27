import type {
  ActivityDto,
  AssetDto,
  CreateProjectInput,
  JobDto,
  ProjectDto,
  UpdateAssetInput,
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
};
