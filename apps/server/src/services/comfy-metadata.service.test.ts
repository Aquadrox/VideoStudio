import { describe, expect, it } from 'vitest';
import { extractComfyMetadataFromPng } from './comfy-metadata.service.js';

function createPngChunk(type: string, data: Buffer): Buffer {
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); // CRC not checked by metadata extractor
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function createSyntheticComfyPng(promptGraph: Record<string, unknown>): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const textPayload = Buffer.concat([
    Buffer.from('prompt', 'latin1'),
    Buffer.from([0]),
    Buffer.from(JSON.stringify(promptGraph), 'utf8'),
  ]);
  const textChunk = createPngChunk('tEXt', textPayload);
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, textChunk, iendChunk]);
}

describe('ComfyUI PNG metadata extraction', () => {
  it('extracts positive prompt, negative prompt, model, LoRAs, seed, steps and CFG from ComfyUI PNG chunks', () => {
    const graph = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' },
      },
      '2': {
        class_type: 'LoraLoader',
        inputs: { lora_name: 'cinematic_lighting_v2.safetensors', strength_model: 0.8 },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'cyberpunk film director studio, warm amber tungsten lighting, 5 fingers' },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'blurry, extra fingers, watermark' },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          seed: 987654321,
          steps: 28,
          cfg: 3.5,
          sampler_name: 'euler',
          scheduler: 'simple',
          positive: ['3', 0],
          negative: ['4', 0],
        },
      },
    };

    const pngBuffer = createSyntheticComfyPng(graph);
    const meta = extractComfyMetadataFromPng(pngBuffer);

    expect(meta).not.toBeNull();
    expect(meta?.positivePrompt).toBe(
      'cyberpunk film director studio, warm amber tungsten lighting, 5 fingers',
    );
    expect(meta?.negativePrompt).toBe('blurry, extra fingers, watermark');
    expect(meta?.modelName).toBe('flux1-dev-fp8.safetensors');
    expect(meta?.loras).toEqual(['cinematic_lighting_v2.safetensors']);
    expect(meta?.seed).toBe(987654321);
    expect(meta?.steps).toBe(28);
    expect(meta?.cfg).toBe(3.5);
    expect(meta?.sampler).toBe('euler');
    expect(meta?.scheduler).toBe('simple');
  });

  it('extracts prompts from Qwen-Image-Edit TextEncodeQwenImage21 fed via a Switch node', () => {
    const qwenGraph = {
      '10': {
        class_type: 'UNETLoader',
        inputs: { unet_name: 'qwen_image_edit_fp8.safetensors' },
      },
      '11': {
        class_type: 'PrimitiveNode',
        inputs: { value: 'Old unused prompt' },
      },
      '12': {
        class_type: 'PrimitiveNode',
        inputs: { value: 'Caspian wearing a dark winter coat in snowy alley, anime style' },
      },
      '13': {
        class_type: 'ImpactSwitch',
        inputs: {
          select: 2,
          input1: ['11', 0],
          input2: ['12', 0],
        },
      },
      '14': {
        class_type: 'TextEncodeQwenImage21',
        inputs: {
          prompt: ['13', 0],
        },
      },
      '15': {
        class_type: 'KSampler',
        inputs: {
          seed: 424242,
          steps: 20,
          cfg: 4.0,
          sampler_name: 'euler',
          positive: ['14', 0],
        },
      },
    };

    const meta = extractComfyMetadataFromPng(createSyntheticComfyPng(qwenGraph));
    expect(meta).not.toBeNull();
    expect(meta?.modelName).toBe('qwen_image_edit_fp8.safetensors');
    expect(meta?.seed).toBe(424242);
    expect(meta?.positivePrompt).toBe(
      'Caspian wearing a dark winter coat in snowy alley, anime style',
    );
  });

  it('returns null for non-PNG buffers', () => {
    expect(extractComfyMetadataFromPng(Buffer.from('hello world'))).toBeNull();
  });
});
