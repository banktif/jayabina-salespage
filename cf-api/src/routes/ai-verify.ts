import type { Env } from '../types';
import { err, ok } from '../utils/helpers';
import { requireAuth } from '../utils/middleware';

type VerifyResult = { passed: boolean; reason: string; confidence: number };

export async function handleAIVerify(req: Request, env: Env, path: string): Promise<Response> {
  // POST /api/ai/verify — verify a photo
  if (req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const { image_url, check_type } = await req.json() as any;
      if (!image_url) return err('Missing image_url');
      if (!check_type || !['before', 'after', 'compare'].includes(check_type)) return err('check_type: before|after|compare');

      let prompt: string;
      if (check_type === 'before') {
        prompt = 'Is there a water tank visible in this image? Answer only YES or NO.';
      } else if (check_type === 'after') {
        prompt = 'Does the water tank in this image look clean? Answer only CLEAN or NOT_CLEAN.';
      } else {
        return err('compare requires 2 images via separate calls', 400);
      }

      const result = await verifyImage(env, image_url, prompt, check_type === 'after' ? 60 : 40);
      return ok(result);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  // POST /api/ai/verify-compare — compare before/after
  if (path === '/api/ai/verify-compare' && req.method === 'POST') {
    try {
      const payload = await requireAuth(req, env);
      if (payload.role !== 'admin') return err('Admin only', 403);

      const { url_before, url_after } = await req.json() as any;
      if (!url_before || !url_after) return err('Missing url_before or url_after');

      const result = await compareImages(env, url_before, url_after);
      return ok(result);
    } catch (e: any) {
      return err(e.msg || 'Error', e.status || 400);
    }
  }

  return err('Not found', 404);
}

async function verifyImage(env: Env, imageUrl: string, question: string, minWords: number): Promise<VerifyResult> {
  try {
    const model = '@cf/llama-3.2-11b-vision-instruct';

    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) return { passed: false, reason: 'Cannot fetch image', confidence: 0 };

    const imageBytes = await imageResp.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(imageBytes)));

    const aiResp = await env.AI.run(model, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
          ]
        }
      ],
      max_tokens: 50
    });

    const answer = ((aiResp as any)?.response || '').trim().toUpperCase();
    const wordCount = answer.split(/\s+/).filter(Boolean).length;

    if (wordCount <= minWords) {
      return { passed: false, reason: `Response too short: "${answer}"`, confidence: 30 };
    }

    const passed = answer.includes('YES') || answer.includes('CLEAN');
    return {
      passed,
      reason: answer,
      confidence: passed ? 85 : 40
    };
  } catch (e: any) {
    console.error('AI verify error:', e);
    return { passed: false, reason: `AI error: ${e.message}`, confidence: 0 };
  }
}

async function compareImages(env: Env, beforeUrl: string, afterUrl: string): Promise<VerifyResult> {
  try {
    const model = '@cf/llama-3.2-11b-vision-instruct';

    const [beforeResp, afterResp] = await Promise.all([fetch(beforeUrl), fetch(afterUrl)]);
    if (!beforeResp.ok || !afterResp.ok) return { passed: false, reason: 'Cannot fetch images', confidence: 0 };

    const beforeBytes = await beforeResp.arrayBuffer();
    const afterBytes = await afterResp.arrayBuffer();
    const b64Before = btoa(String.fromCharCode(...new Uint8Array(beforeBytes)));
    const b64After = btoa(String.fromCharCode(...new Uint8Array(afterBytes)));

    const aiResp = await env.AI.run(model, {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Image 1 shows a water tank BEFORE cleaning. Image 2 shows a water tank AFTER cleaning. Does image 2 look cleaner than image 1? Answer only one word: CLEANER, SAME, or DIRTIER.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64Before}` } },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64After}` } }
          ]
        }
      ],
      max_tokens: 20
    });

    const answer = ((aiResp as any)?.response || '').trim().toUpperCase();
    const passed = answer.includes('CLEANER');

    return { passed, reason: answer, confidence: passed ? 80 : 30 };
  } catch (e: any) {
    console.error('AI compare error:', e);
    return { passed: false, reason: `AI error: ${e.message}`, confidence: 0 };
  }
}
