export interface ReelsRankingSignals {
  viewedPostIds: Set<string>;
  likedCreatorIds: Set<string>;
  followingIds: Set<string>;
}

export interface ReelsRankingWeights {
  recencyGravity: number;
  likesWeight: number;
  savesWeight: number;
  commentsWeight: number;
  sharesWeight: number;
  viewsWeight: number;
  creatorLikedBoost: number;
  followingBoost: number;
  seenPenalty: number;
  explorationMax: number;
}

export const DEFAULT_REELS_RANKING_WEIGHTS: ReelsRankingWeights = {
  recencyGravity: 1.35,
  likesWeight: 0.4,
  savesWeight: 0.6,
  commentsWeight: 0.3,
  sharesWeight: 0.25,
  viewsWeight: 0.02,
  creatorLikedBoost: 2.0,
  followingBoost: 1.5,
  seenPenalty: 8.0,
  explorationMax: 0.35,
};

function stableJitter(postId: string, max: number): number {
  let hash = 0;
  for (let i = 0; i < postId.length; i++) {
    hash = (hash * 31 + postId.charCodeAt(i)) >>> 0;
  }
  return ((hash % 1000) / 1000) * max;
}

export function scoreReelsPost(
  post: any,
  signals: ReelsRankingSignals,
  weights: ReelsRankingWeights = DEFAULT_REELS_RANKING_WEIGHTS,
  nowMs: number = Date.now(),
): number {
  const createdAt = post?.created_at ? new Date(post.created_at).getTime() : nowMs;
  const ageHours = Math.max((nowMs - createdAt) / (1000 * 60 * 60), 0);
  const recency = 12 / Math.pow(ageHours + 2, weights.recencyGravity);

  const likes = Number(post?.likes_count) || 0;
  const saves = Number(post?.saves_count) || 0;
  const comments = Number(post?.comments_count) || 0;
  const shares = Number(post?.shares_count) || 0;
  const views = Number(post?.views_count) || 0;

  const engagement =
    likes * weights.likesWeight +
    saves * weights.savesWeight +
    comments * weights.commentsWeight +
    shares * weights.sharesWeight +
    views * weights.viewsWeight;

  const creatorId = post?.user_id?.toString();
  let affinity = 0;
  if (creatorId) {
    if (signals.likedCreatorIds.has(creatorId)) {
      affinity += weights.creatorLikedBoost;
    }
    if (signals.followingIds.has(creatorId)) {
      affinity += weights.followingBoost;
    }
  }

  const postId = post?.id?.toString();
  let seenPenalty =
    postId && signals.viewedPostIds.has(postId) ? weights.seenPenalty : 0;
  // Brand-new uploads should still surface even if the creator previewed them once.
  if (ageHours < 3) {
    seenPenalty *= 0.2;
  }

  const exploration = postId ? stableJitter(postId, weights.explorationMax) : 0;

  // Strong boost for very recent posts so new uploads appear quickly in For You.
  const freshBoost = ageHours < 6 ? 5 : ageHours < 24 ? 2 : 0;

  return recency + engagement + affinity + exploration + freshBoost - seenPenalty;
}

export function rankReelsPosts(
  posts: any[],
  signals: ReelsRankingSignals,
  limit: number,
  diversify: (items: any[], max: number) => any[],
  weights?: ReelsRankingWeights,
): any[] {
  if (posts.length === 0) return [];

  const nowMs = Date.now();
  const scored = posts
    .map((post) => ({
      post,
      score: scoreReelsPost(post, signals, weights, nowMs),
    }))
    .sort((a, b) => b.score - a.score);

  const shortlistSize = Math.min(Math.max(limit * 4, limit + 20), scored.length);
  const shortlist = scored.slice(0, shortlistSize).map((entry) => entry.post);

  return diversify(shortlist, limit);
}

export function toRankingSignals(raw: {
  viewedPostIds?: string[];
  likedCreatorIds?: string[];
  followingIds?: string[];
}): ReelsRankingSignals {
  return {
    viewedPostIds: new Set(raw.viewedPostIds || []),
    likedCreatorIds: new Set(raw.likedCreatorIds || []),
    followingIds: new Set(raw.followingIds || []),
  };
}
