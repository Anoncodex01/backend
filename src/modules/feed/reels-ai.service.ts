import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../../core/gemini/gemini.service';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

export type ReelsViewerProfile = {
  interestIds: string[];
  viewedCaptions: string[];
  likedCaptions: string[];
  savedCaptions: string[];
  completedCaptions: string[];
  skippedPostIds: Set<string>;
};

@Injectable()
export class ReelsAiService {
  private readonly logger = new Logger(ReelsAiService.name);
  private readonly embedCacheTtl = 60 * 60 * 24 * 7;

  constructor(
    private geminiService: GeminiService,
    private supabaseService: SupabaseService,
    private redisService: RedisService,
  ) {}

  isGeminiConfigured(): boolean {
    return this.geminiService.isConfigured;
  }

  async buildViewerProfile(userId: string): Promise<ReelsViewerProfile> {
    const raw = await this.supabaseService.getUserReelsAiSignals(userId);
    return {
      interestIds: raw.interestIds,
      viewedCaptions: raw.viewedCaptions,
      likedCaptions: raw.likedCaptions,
      savedCaptions: raw.savedCaptions,
      completedCaptions: raw.completedCaptions,
      skippedPostIds: new Set(raw.skippedPostIds),
    };
  }

  profileToText(profile: ReelsViewerProfile): string {
    const parts = ['Viewer in Tanzania watching short-form video reels.'];

    if (profile.interestIds.length > 0) {
      parts.push(`Interests: ${profile.interestIds.join(', ')}.`);
    }
    if (profile.completedCaptions.length > 0) {
      parts.push(
        `Watched to the end: ${profile.completedCaptions.slice(0, 6).join('; ')}.`,
      );
    }
    if (profile.likedCaptions.length > 0) {
      parts.push(`Liked: ${profile.likedCaptions.slice(0, 6).join('; ')}.`);
    }
    if (profile.savedCaptions.length > 0) {
      parts.push(`Saved: ${profile.savedCaptions.slice(0, 4).join('; ')}.`);
    }
    if (profile.viewedCaptions.length > 0) {
      parts.push(
        `Recently viewed: ${profile.viewedCaptions.slice(0, 6).join('; ')}.`,
      );
    }

    return parts.join(' ');
  }

  postToText(post: any): string {
    const caption = (post?.caption ?? post?.description ?? '').toString();
    const location = (post?.location_name ?? post?.location ?? '').toString();
    const hashtags = Array.isArray(post?.hashtags)
      ? post.hashtags.join(' ')
      : '';
    const username =
      post?.user?.username?.toString() ??
      post?.users?.username?.toString() ??
      '';
    return `${caption}. ${hashtags}. Location: ${location}. Creator: @${username}`.trim();
  }

  async rerankPosts(
    posts: any[],
    profile: ReelsViewerProfile,
  ): Promise<{ posts: any[]; source: 'gemini' | 'rules' }> {
    if (!this.geminiService.isConfigured || posts.length === 0) {
      return { posts, source: 'rules' };
    }

    try {
      const profileText = this.profileToText(profile);
      const profileEmbedding = await this.geminiService.embedText(profileText);
      if (!profileEmbedding) {
        return { posts, source: 'rules' };
      }

      let usedGemini = false;
      const scored = await Promise.all(
        posts.map(async (post) => {
          const text = this.postToText(post);
          const embedding = await this.getPostEmbedding(post.id?.toString(), text);
          let semantic = 0;
          if (embedding) {
            usedGemini = true;
            semantic = GeminiService.cosineSimilarity(
              profileEmbedding,
              embedding,
            );
          }

          const postId = post.id?.toString() ?? '';
          let behavior = 0;
          if (profile.skippedPostIds.has(postId)) {
            behavior -= 0.35;
          }

          return {
            post,
            score: semantic * 0.55 + behavior,
          };
        }),
      );

      scored.sort((a, b) => b.score - a.score);
      return {
        posts: scored.map((entry) => entry.post),
        source: usedGemini ? 'gemini' : 'rules',
      };
    } catch (error) {
      this.logger.warn(`Reels Gemini rerank failed: ${error}`);
      return { posts, source: 'rules' };
    }
  }

  async recordWatchEvent(input: {
    userId: string;
    postId: string;
    watchedMs: number;
    durationMs: number;
    completed: boolean;
  }): Promise<void> {
    await this.supabaseService.recordReelWatchEvent(input);
    await this.redisService.deletePattern(`feed:reels:personalized:v2:${input.userId}:*`);
    await this.redisService.deletePattern(`feed:explore:personalized:v1:${input.userId}:*`);
    await this.redisService.deletePattern(`feed:ranking:signals:${input.userId}`);
  }

  async suggestCaption(input: {
    caption?: string;
    locationName?: string;
    username?: string;
    hashtags?: string[];
    forUpload?: boolean;
  }): Promise<{ caption: string; hashtags: string[] } | null> {
    const existing = (input.caption ?? '').trim();
    const location = (input.locationName ?? '').trim();
    const tags = (input.hashtags ?? []).join(' ');
    const user = (input.username ?? '').trim();

    const prompt = input.forUpload
      ? `You write viral short-form video captions for WhapVibez (Tanzania/East Africa).
Create ONE caption (max 220 chars) and 5-8 relevant hashtags for a new reel upload.
Use English or Swahili mix if it fits. No quotes. No markdown.
Return JSON only: {"caption":"...","hashtags":["tag1","tag2"]}
Context — location: ${location || 'none'}; draft caption: ${existing || 'none'}; draft tags: ${tags || 'none'}`
      : `You improve short-form video captions for WhapVibez (Tanzania/East Africa).
Create ONE engaging caption (max 220 chars) and 5-8 hashtags for this existing reel.
Keep the original vibe if a caption exists. No quotes. No markdown.
Return JSON only: {"caption":"...","hashtags":["tag1","tag2"]}
Creator: ${user || 'unknown'}; location: ${location || 'none'}; current caption: ${existing || 'none'}; tags: ${tags || 'none'}`;

    const raw = await this.geminiService.generateJson(prompt, {
      temperature: 0.75,
      maxOutputTokens: 400,
    });
    if (!raw) {
      if (!this.geminiService.isConfigured) {
        this.logger.warn('Caption suggest skipped: GEMINI_API_KEY not configured');
      } else {
        this.logger.warn('Caption suggest failed: Gemini returned empty response');
      }
      return null;
    }

    return this.parseCaptionJson(raw);
  }

  async generateCaptionForPost(
    postId: string,
    userId: string,
  ): Promise<{ caption: string; hashtags: string[] } | null> {
    const post = await this.supabaseService.getPostForAiCaption(postId);
    if (!post) return null;

    if (post.user_id?.toString() !== userId) {
      return null;
    }

    const userRow = Array.isArray(post.users) ? post.users[0] : post.users;

    return this.suggestCaption({
      caption: post.caption,
      locationName: post.location_name,
      username: userRow?.username,
      hashtags: post.hashtags,
      forUpload: false,
    });
  }

  async applyCaptionToPost(
    postId: string,
    userId: string,
    caption: string,
    hashtags: string[],
  ): Promise<boolean> {
    return this.supabaseService.updatePostCaption(postId, userId, caption, hashtags);
  }

  private parseCaptionJson(
    raw: string,
  ): { caption: string; hashtags: string[] } | null {
    try {
      let cleaned = raw.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '')
          .trim();
      }

      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart < 0 || jsonEnd <= jsonStart) {
        const fallback = cleaned.replace(/^["']|["']$/g, '').trim();
        if (fallback.length >= 3) {
          return { caption: fallback.slice(0, 220), hashtags: [] };
        }
        return null;
      }

      const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as {
        caption?: string;
        hashtags?: string[] | string;
      };
      const caption = parsed.caption?.trim();
      if (!caption) return null;

      const rawTags = parsed.hashtags;
      const tagList = Array.isArray(rawTags)
        ? rawTags
        : typeof rawTags === 'string'
          ? rawTags.split(/[\s,]+/)
          : [];

      const hashtags = tagList
        .map((tag) => tag.toString().replace(/^#/, '').trim())
        .filter(Boolean)
        .slice(0, 10);
      return { caption: caption.slice(0, 220), hashtags };
    } catch {
      return null;
    }
  }

  private async getPostEmbedding(
    postId: string | undefined,
    text: string,
  ): Promise<number[] | null> {
    if (!postId) return this.geminiService.embedText(text);

    const cacheKey = `reels:embed:post:${postId}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as number[];
      } catch {
        // ignore
      }
    }

    const embedding = await this.geminiService.embedText(text);
    if (embedding) {
      await this.redisService.set(
        cacheKey,
        JSON.stringify(embedding),
        this.embedCacheTtl,
      );
    }
    return embedding;
  }
}
