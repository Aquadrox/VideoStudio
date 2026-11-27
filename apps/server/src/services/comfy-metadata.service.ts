import zlib from 'node:zlib';
import type { ComfyMetadata } from '@videostudio/shared';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface RawTextChunks {
  [key: string]: string;
}

/**
 * Extracts text metadata chunks (tEXt, iTXt, zTXt) from a PNG buffer without external tools.
 * ComfyUI stores its API prompt graph under `prompt` and UI graph under `workflow`.
 */
export function extractPngTextChunks(buffer: Buffer): RawTextChunks {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return {};
  }

  const chunks: RawTextChunks = {};
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > buffer.length) {
      break;
    }

    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'tEXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0) {
        const key = data.toString('latin1', 0, nullIdx);
        const value = data.toString('utf8', nullIdx + 1);
        chunks[key] = value;
      }
    } else if (type === 'zTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0 && nullIdx + 2 <= data.length) {
        const key = data.toString('latin1', 0, nullIdx);
        const compressionMethod = data[nullIdx + 1];
        if (compressionMethod === 0) {
          try {
            const inflated = zlib.inflateSync(data.subarray(nullIdx + 2));
            chunks[key] = inflated.toString('utf8');
          } catch {
            // Ignore malformed compressed chunk
          }
        }
      }
    } else if (type === 'iTXt') {
      const nullIdx = data.indexOf(0);
      if (nullIdx > 0 && nullIdx + 3 <= data.length) {
        const key = data.toString('latin1', 0, nullIdx);
        const compressionFlag = data[nullIdx + 1];
        const compressionMethod = data[nullIdx + 2];
        const langEnd = data.indexOf(0, nullIdx + 3);
        if (langEnd !== -1) {
          const translatedEnd = data.indexOf(0, langEnd + 1);
          if (translatedEnd !== -1) {
            const textPayload = data.subarray(translatedEnd + 1);
            if (compressionFlag === 1 && compressionMethod === 0) {
              try {
                chunks[key] = zlib.inflateSync(textPayload).toString('utf8');
              } catch {
                // Ignore malformed compressed chunk
              }
            } else {
              chunks[key] = textPayload.toString('utf8');
            }
          }
        }
      }
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // skip 4-byte CRC
  }

  return chunks;
}

function safeJsonParse(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function resolveNodeText(
  graph: Record<string, unknown>,
  ref: unknown,
): string | undefined {
  if (typeof ref === 'string') return ref;
  if (!Array.isArray(ref) || typeof ref[0] !== 'string') return undefined;

  const targetNode = graph[ref[0]];
  if (!targetNode || typeof targetNode !== 'object') return undefined;
  const inputs = (targetNode as { inputs?: Record<string, unknown> }).inputs;
  if (!inputs) return undefined;

  if (typeof inputs.text === 'string' && inputs.text.trim()) {
    return inputs.text.trim();
  }
  if (typeof inputs.prompt === 'string' && inputs.prompt.trim()) {
    return inputs.prompt.trim();
  }
  if (typeof inputs.string === 'string' && inputs.string.trim()) {
    return inputs.string.trim();
  }
  return undefined;
}

/**
 * Heuristically parses a ComfyUI prompt graph into structured generation metadata.
 */
export function parseComfyGraph(
  rawPromptGraph?: Record<string, unknown>,
  rawWorkflow?: Record<string, unknown>,
  source: 'png_chunks' | 'media_tags' = 'png_chunks',
): ComfyMetadata | null {
  if (!rawPromptGraph && !rawWorkflow) {
    return null;
  }

  let positivePrompt: string | undefined;
  let negativePrompt: string | undefined;
  let modelName: string | undefined;
  let seed: number | string | undefined;
  let steps: number | undefined;
  let cfg: number | undefined;
  let sampler: string | undefined;
  let scheduler: string | undefined;
  const loras = new Set<string>();

  if (rawPromptGraph) {
    const fallbackTexts: string[] = [];

    for (const nodeValue of Object.values(rawPromptGraph)) {
      if (!nodeValue || typeof nodeValue !== 'object') continue;
      const node = nodeValue as {
        class_type?: string;
        inputs?: Record<string, unknown>;
      };
      const classType = node.class_type ?? '';
      const inputs = node.inputs ?? {};

      // Samplers (KSampler, KSamplerAdvanced, SamplerCustom, etc.)
      if (/sampler/i.test(classType)) {
        if (seed === undefined) {
          const candidateSeed = inputs.seed ?? inputs.noise_seed;
          if (typeof candidateSeed === 'number' || typeof candidateSeed === 'string') {
            seed = candidateSeed;
          }
        }
        if (steps === undefined && typeof inputs.steps === 'number') {
          steps = inputs.steps;
        }
        if (cfg === undefined && typeof inputs.cfg === 'number') {
          cfg = inputs.cfg;
        }
        if (sampler === undefined && typeof inputs.sampler_name === 'string') {
          sampler = inputs.sampler_name;
        }
        if (scheduler === undefined && typeof inputs.scheduler === 'string') {
          scheduler = inputs.scheduler;
        }
        if (!positivePrompt && inputs.positive !== undefined) {
          positivePrompt = resolveNodeText(rawPromptGraph, inputs.positive);
        }
        if (!negativePrompt && inputs.negative !== undefined) {
          negativePrompt = resolveNodeText(rawPromptGraph, inputs.negative);
        }
      }

      // Checkpoints / Diffusion models (CheckpointLoaderSimple, UNETLoader, DiffusionModelLoader)
      if (!modelName && /(checkpoint|unet|diffusion.*loader)/i.test(classType)) {
        const candidateModel = inputs.ckpt_name ?? inputs.unet_name ?? inputs.model_name;
        if (typeof candidateModel === 'string' && candidateModel.trim()) {
          modelName = candidateModel.trim();
        }
      }

      // LoRAs
      if (/lora/i.test(classType)) {
        const loraName = inputs.lora_name;
        if (typeof loraName === 'string' && loraName.trim()) {
          loras.add(loraName.trim());
        }
      }

      // Fallback CLIPTextEncode collection
      if (/cliptextencode/i.test(classType) && typeof inputs.text === 'string' && inputs.text.trim()) {
        fallbackTexts.push(inputs.text.trim());
      }
    }

    if (!positivePrompt && fallbackTexts[0]) {
      positivePrompt = fallbackTexts[0];
    }
    if (!negativePrompt && fallbackTexts[1]) {
      negativePrompt = fallbackTexts[1];
    }
  }

  return {
    source,
    positivePrompt,
    negativePrompt,
    modelName,
    loras: Array.from(loras),
    seed,
    steps,
    cfg,
    sampler,
    scheduler,
    rawPromptGraph,
    rawWorkflow,
  };
}

export function extractComfyMetadataFromPng(buffer: Buffer): ComfyMetadata | null {
  const chunks = extractPngTextChunks(buffer);
  const rawPromptGraph = safeJsonParse(chunks.prompt);
  const rawWorkflow = safeJsonParse(chunks.workflow);
  return parseComfyGraph(rawPromptGraph, rawWorkflow, 'png_chunks');
}

export function extractComfyMetadataFromTags(
  tags: Record<string, string> | undefined,
): ComfyMetadata | null {
  if (!tags) return null;

  // Video containers may store ComfyUI JSON in `prompt`/`workflow` or `comment`
  const lowerTags: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    lowerTags[k.toLowerCase()] = v;
  }

  let rawPromptGraph = safeJsonParse(lowerTags.prompt);
  let rawWorkflow = safeJsonParse(lowerTags.workflow);

  if (!rawPromptGraph && !rawWorkflow && lowerTags.comment) {
    const parsedComment = safeJsonParse(lowerTags.comment);
    if (parsedComment) {
      if (typeof parsedComment.prompt === 'string') {
        rawPromptGraph = safeJsonParse(parsedComment.prompt);
      } else if (parsedComment.prompt && typeof parsedComment.prompt === 'object') {
        rawPromptGraph = parsedComment.prompt as Record<string, unknown>;
      }
      if (typeof parsedComment.workflow === 'string') {
        rawWorkflow = safeJsonParse(parsedComment.workflow);
      } else if (parsedComment.workflow && typeof parsedComment.workflow === 'object') {
        rawWorkflow = parsedComment.workflow as Record<string, unknown>;
      }
    }
  }

  return parseComfyGraph(rawPromptGraph, rawWorkflow, 'media_tags');
}
