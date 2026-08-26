import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EMBED_MODEL = 'gemini-embedding-001';
const GENERATE_MODEL = 'gemini-3.6-flash';
const GENERATE_MODEL_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const MAX_CONCURRENT = 8;

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async embedText(text: string): Promise<number[] | null> {
    const results = await this.embedTexts([text]);
    return results[0] ?? null;
  }

  async embedTexts(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.isConfigured || texts.length === 0) {
      return texts.map(() => null);
    }

    const outputs: (number[] | null)[] = new Array(texts.length).fill(null);

    for (let i = 0; i < texts.length; i += MAX_CONCURRENT) {
      const chunk = texts.slice(i, i + MAX_CONCURRENT);
      const embeddings = await Promise.all(
        chunk.map((text) => this.embedOne(text)),
      );
      for (let j = 0; j < embeddings.length; j++) {
        outputs[i + j] = embeddings[j];
      }
    }

    return outputs;
  }

  async generateText(
    prompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<string | null> {
    return this.generateContent(prompt, options);
  }

  async generateJson(
    prompt: string,
    options: { maxOutputTokens?: number; temperature?: number } = {},
  ): Promise<string | null> {
    return this.generateContent(prompt, {
      ...options,
      jsonMode: true,
    });
  }

  private async generateContent(
    prompt: string,
    options: {
      maxOutputTokens?: number;
      temperature?: number;
      jsonMode?: boolean;
    } = {},
  ): Promise<string | null> {
    if (!this.isConfigured || !prompt.trim()) return null;

    const generationConfig: Record<string, unknown> = {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 512,
    };
    if (options.jsonMode) {
      generationConfig.responseMimeType = 'application/json';
    }

    const models = [GENERATE_MODEL, ...GENERATE_MODEL_FALLBACKS.filter((m) => m !== GENERATE_MODEL)];

    for (const model of models) {
      const text = await this.generateWithModel(model, prompt, generationConfig);
      if (text) return text;
    }

    return null;
  }

  private async generateWithModel(
    model: string,
    prompt: string,
    generationConfig: Record<string, unknown>,
  ): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt.slice(0, 12000) }] }],
          generationConfig,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`Gemini generate failed (${model}, ${response.status}): ${body.slice(0, 240)}`);
        return null;
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      };

      const candidate = json.candidates?.[0];
      if (candidate?.finishReason === 'SAFETY') {
        this.logger.warn(`Gemini generate blocked by safety filter (${model})`);
        return null;
      }

      const text = candidate?.content?.parts?.[0]?.text?.trim();
      return text || null;
    } catch (error) {
      this.logger.warn(`Gemini generate error (${model}): ${error}`);
      return null;
    }
  }

  private async embedOne(text: string): Promise<number[] | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${EMBED_MODEL}`,
          content: {
            parts: [{ text: (text || ' ').slice(0, 8000) }],
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`Gemini embed failed (${response.status}): ${body}`);
        return null;
      }

      const json = (await response.json()) as {
        embedding?: { values?: number[] };
      };

      return json.embedding?.values ?? null;
    } catch (error) {
      this.logger.warn(`Gemini embed error: ${error}`);
      return null;
    }
  }

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) {
      return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
