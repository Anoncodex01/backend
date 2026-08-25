import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EMBED_MODEL = 'text-embedding-004';
const MAX_BATCH = 20;

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

    const outputs: (number[] | null)[] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const chunk = texts.slice(i, i + MAX_BATCH);
      const batch = await this.embedBatch(chunk);
      outputs.push(...batch);
    }
    return outputs;
  }

  private async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${this.apiKey}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${EMBED_MODEL}`,
            content: {
              parts: [{ text: (text || ' ').slice(0, 8000) }],
            },
          })),
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(`Gemini batch embed failed (${response.status}): ${body}`);
        return texts.map(() => null);
      }

      const json = (await response.json()) as {
        embeddings?: Array<{ values?: number[] }>;
      };

      return texts.map((_, index) => json.embeddings?.[index]?.values ?? null);
    } catch (error) {
      this.logger.warn(`Gemini batch embed error: ${error}`);
      return texts.map(() => null);
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
