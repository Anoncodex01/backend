import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

interface SupabaseOptions {
  url: string;
  serviceKey: string;
  jwtSecret: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient;
  private jwtSecret: string;

  constructor(@Inject("SUPABASE_OPTIONS") private options: SupabaseOptions) {}

  async onModuleInit() {
    this.client = createClient(this.options.url, this.options.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.jwtSecret = this.options.jwtSecret;
    console.log("✅ Supabase connected");
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getJwtSecret(): string {
    return this.jwtSecret;
  }

  // ===== User Operations =====

  async getUser(userId: string) {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) throw error;
    return data;
  }

  async getUserByUsername(username: string) {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  /**
   * Anonymize a user for account deletion (Google Play compliance).
   * Keeps user id and records for audit; removes PII from users + shops.
   * Auth email is updated so the user cannot log in again.
   * Original email and username are freed so the user can sign up again with the same email/username.
   */
  async anonymizeUser(userId: string): Promise<void> {
    const shortId = userId.replace(/-/g, "").slice(0, 12);
    const anonymizedEmail = `deleted_${shortId}@anonymized.local`;
    const anonymizedUsername = `deleted_${shortId}`;

    const { error: userError } = await this.client
      .from("users")
      .update({
        email: anonymizedEmail,
        username: anonymizedUsername,
        full_name: "Deleted User",
        bio: null,
        profile_image_url: null,
        phone_number: null,
        website: null,
        location: null,
        dob: null,
        gender: null,
        category: null,
        deleted_at: new Date().toISOString(),
        is_anonymized: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (userError) throw userError;

    const { error: shopError } = await this.client
      .from("shops")
      .update({
        shop_name: "Deleted Shop",
        description: null,
        logo_url: null,
        banner_url: null,
        anonymized_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (shopError) throw shopError;

    const { error: authError } = await this.client.auth.admin.updateUserById(
      userId,
      { email: anonymizedEmail },
    );

    if (authError) throw authError;
  }

  async getUserPosts(
    userId: string,
    options: {
      limit?: number;
      offset?: number;
      cursor?: string;
      isPublic?: boolean;
      videoOnly?: boolean;
    } = {},
  ) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("user_id", userId)
      .eq("is_draft", false)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (options.isPublic !== undefined) {
      query = query.eq("is_public", options.isPublic);
    }
    if (options.videoOnly) {
      query = query.or(
        "video_url.not.is.null,video_path.not.is.null,stream_uid.not.is.null",
      );
    }
    if (options.cursor) {
      query = query.lt("created_at", options.cursor).limit(limit);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((post: any) => this.normalizePostMedia(post));
  }

  async getUserStats(userId: string) {
    const [postsResult, followersResult, followingResult] = await Promise.all([
      this.client
        .from("posts")
        .select("id", { count: "exact" })
        .eq("user_id", userId)
        .eq("is_public", true)
        .eq("is_draft", false),
      this.client
        .from("follows")
        .select("id", { count: "exact" })
        .eq("following_id", userId),
      this.client
        .from("follows")
        .select("id", { count: "exact" })
        .eq("follower_id", userId),
    ]);

    return {
      posts_count: postsResult.count || 0,
      followers_count: followersResult.count || 0,
      following_count: followingResult.count || 0,
    };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const { data } = await this.client
      .from("follows")
      .select("id")
      .eq("follower_id", followerId)
      .eq("following_id", followingId)
      .maybeSingle();
    return !!data;
  }

  async getFollowers(userId: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from("follows")
      .select("follower_id")
      .eq("following_id", userId)
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      const followerIds = data.map((f) => f.follower_id);
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", followerIds);
      return users || [];
    }
    return [];
  }

  async getFollowing(userId: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId)
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      const followingIds = data.map((f) => f.following_id);
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", followingIds);
      return users || [];
    }
    return [];
  }

  // ===== Search Operations =====

  async searchUsers(query: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from("users")
      .select("id, username, full_name, profile_image_url, is_verified")
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async searchPosts(query: string, limit = 20, offset = 0, videoOnly = false) {
    let queryBuilder = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_public", true)
      .eq("is_draft", false)
      .ilike("caption", `%${query}%`)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (videoOnly) {
      queryBuilder = queryBuilder.or(
        "video_url.not.is.null,video_path.not.is.null,stream_uid.not.is.null",
      );
    }

    const { data, error } = await queryBuilder;
    if (error) throw error;

    if (data && data.length > 0) {
      const normalizedData = data.map((post: any) =>
        this.normalizePostMedia(post),
      );
      const userIds = [...new Set(data.map((p) => p.user_id))];
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", userIds);
      const userMap = new Map((users || []).map((u) => [u.id, u]));
      return normalizedData.map((post) => ({
        ...post,
        user: userMap.get(post.user_id) || null,
      }));
    }
    return data || [];
  }

  // ===== Community Operations =====

  async getCommunities(limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from("communities")
      .select("*")
      .eq("is_public", true)
      .order("members_count", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async getMyCommunities(userId: string) {
    const { data: bannedRows, error: bannedError } = await this.client
      .from("community_banned_members")
      .select("community_id")
      .eq("user_id", userId);

    if (bannedError) throw bannedError;

    const bannedIds = new Set(
      (bannedRows || []).map((row: any) => row.community_id),
    );

    const { data: memberships, error: membershipError } = await this.client
      .from("community_members")
      .select("community_id, role, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false });

    if (membershipError) throw membershipError;

    const visibleMemberships = (memberships || []).filter(
      (membership: any) => !bannedIds.has(membership.community_id),
    );
    const membershipIds = visibleMemberships.map(
      (membership: any) => membership.community_id,
    );
    const membershipIdSet = new Set(membershipIds);

    const { data: ownedCommunities, error: ownedError } = await this.client
      .from("communities")
      .select("*")
      .eq("creator_id", userId);

    if (ownedError) throw ownedError;

    const visibleOwnedCommunities = (ownedCommunities || []).filter(
      (community: any) => !bannedIds.has(community.id),
    );
    const ownedIds = visibleOwnedCommunities.map((community: any) => community.id);
    const communityIds = Array.from(new Set([...membershipIds, ...ownedIds]));

    if (communityIds.length === 0) {
      return [];
    }

    const { data: communities, error: communitiesError } = await this.client
      .from("communities")
      .select("*")
      .in("id", communityIds);

    if (communitiesError) throw communitiesError;

    const communityMap = new Map(
      (communities || []).map((community: any) => [community.id, community]),
    );
    for (const community of visibleOwnedCommunities) {
      communityMap.set(community.id, community);
    }

    const membershipRows = [
      ...visibleMemberships,
      ...visibleOwnedCommunities
        .filter((community: any) => !membershipIdSet.has(community.id))
        .map((community: any) => ({
          community_id: community.id,
          role: "admin",
          joined_at: community.created_at,
        })),
    ];

    return membershipRows
      .map((membership: any) => {
        const community = communityMap.get(membership.community_id);
        if (!community) return null;
        return {
          ...community,
          is_member: true,
          user_role: membership.role,
        };
      })
      .filter(Boolean);
  }

  async getCommunity(communityId: string) {
    const { data, error } = await this.client
      .from("communities")
      .select("*")
      .eq("id", communityId)
      .single();

    if (error) throw error;
    return data;
  }

  async isCommunityMember(
    communityId: string,
    userId: string,
  ): Promise<boolean> {
    const { data } = await this.client
      .from("community_members")
      .select("id")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return true;

    const { data: community } = await this.client
      .from("communities")
      .select("creator_id")
      .eq("id", communityId)
      .maybeSingle();
    return community?.creator_id === userId;
  }

  async getCommunityMembers(
    communityId: string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const offset = Math.max(Number(options.offset) || 0, 0);

    const { data: bannedRows, error: bannedError } = await this.client
      .from("community_banned_members")
      .select("user_id")
      .eq("community_id", communityId);

    if (bannedError) throw bannedError;

    const bannedIds = new Set(
      (bannedRows || []).map((row: any) => row.user_id),
    );

    const { data: members, error: membersError } = await this.client
      .from("community_members")
      .select("*")
      .eq("community_id", communityId)
      .order("role", { ascending: true })
      .order("joined_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (membersError) throw membersError;

    const visibleMembers = (members || []).filter(
      (member: any) => member.user_id && !bannedIds.has(member.user_id),
    );
    const userIds = [
      ...new Set(visibleMembers.map((member: any) => member.user_id)),
    ];

    if (userIds.length === 0) {
      return visibleMembers;
    }

    const { data: users, error: usersError } = await this.client
      .from("users")
      .select("id, username, full_name, profile_image_url, is_verified")
      .in("id", userIds);

    if (usersError) throw usersError;

    const usersById = new Map(
      (users || []).map((user: any) => [user.id, user]),
    );
    const missingUserIds = userIds.filter((userId) => !usersById.has(userId));

    for (const userId of missingUserIds) {
      const { data: authUser } =
        await this.client.auth.admin.getUserById(userId);
      const rawUser = authUser?.user;
      if (!rawUser) continue;

      const metadata: any = rawUser.user_metadata || {};
      const emailName = rawUser.email?.split("@")[0];
      usersById.set(userId, {
        id: userId,
        username: metadata.user_name || metadata.username || emailName || null,
        full_name: metadata.full_name || metadata.name || emailName || null,
        name: metadata.name || metadata.full_name || emailName || null,
        profile_image_url:
          metadata.profile_image_url ||
          metadata.avatar_url ||
          metadata.picture ||
          null,
        avatar_url: metadata.avatar_url || metadata.picture || null,
        is_verified: false,
      });
    }

    return visibleMembers.map((member: any) => ({
      ...member,
      user: usersById.get(member.user_id) || null,
    }));
  }

  // ===== Post Operations =====

  /** Slim columns for feeds (faster network + parsing, no select('*')) */
  private static readonly FEED_POST_SELECT =
    "id,user_id,caption,created_at,video_url,video_path,stream_uid,thumbnail_url,video_thumbnail_url,image_urls,views_count,likes_count,comments_count,shares_count,saves_count,is_public,post_type,report_count,ads_allowed,moderation_status,moderation_reason";

  private normalizePostMedia(post: any) {
    const normalized = { ...post };
    const imageUrls: string[] = [];
    const appendIfUrl = (value: any) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (!trimmed) return;
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        imageUrls.push(trimmed);
      }
    };
    const appendFromUnknown = (value: any) => {
      if (value == null) return;
      if (Array.isArray(value)) {
        for (const item of value) appendFromUnknown(item);
        return;
      }
      if (typeof value === "object") {
        appendIfUrl(value?.url ?? value?.src ?? value?.path);
        return;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return;
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmed);
            appendFromUnknown(parsed);
            return;
          } catch {
            // Fall through and treat as plain string URL.
          }
        }
        appendIfUrl(trimmed);
      }
    };

    appendFromUnknown(post?.image_urls);
    appendFromUnknown(post?.images);
    appendIfUrl(post?.image_url);
    appendIfUrl(post?.media_url);

    normalized.image_urls = Array.from(new Set(imageUrls));

    const currentThumb =
      typeof normalized.thumbnail_url === "string"
        ? normalized.thumbnail_url.trim()
        : "";
    if (!currentThumb) {
      if (normalized.post_type === "video") {
        const videoThumb =
          typeof normalized.video_thumbnail_url === "string"
            ? normalized.video_thumbnail_url.trim()
            : "";
        if (videoThumb) normalized.thumbnail_url = videoThumb;
      } else if (normalized.image_urls.length > 0) {
        normalized.thumbnail_url = normalized.image_urls[0];
      }
    }

    return normalized;
  }

  async getPosts(options: {
    limit?: number;
    offset?: number;
    cursor?: string;
    userId?: string;
    isPublic?: boolean;
    orderBy?: string;
  }) {
    const limit = options.limit || 20;
    let query = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_draft", false)
      .order(options.orderBy || "created_at", { ascending: false })
      .order("id", { ascending: false });

    if (options.userId) {
      query = query.eq("user_id", options.userId);
    }
    if (options.isPublic !== undefined) {
      query = query.eq("is_public", options.isPublic);
    }
    if (options.cursor) {
      query = query.lt("created_at", options.cursor).limit(limit);
    } else if (options.offset !== undefined) {
      query = query.range(options.offset, options.offset + limit - 1);
    } else {
      query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      const normalizedData = data.map((post: any) =>
        this.normalizePostMedia(post),
      );
      const userIds = [...new Set(data.map((p: any) => p.user_id))];
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", userIds);
      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      return normalizedData.map((post: any) => ({
        ...post,
        user: userMap.get(post.user_id) || null,
      }));
    }
    return (data || []).map((post: any) => this.normalizePostMedia(post));
  }

  async getPost(postId: string) {
    const { data, error } = await this.client
      .from("posts")
      .select("*")
      .eq("id", postId)
      .single();

    if (error) throw error;

    if (data && data.user_id) {
      const { data: user } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .eq("id", data.user_id)
        .single();
      return { ...data, user };
    }

    return data;
  }

  async getTrendingPosts(limit = 20, offset = 0, cursor?: string) {
    // --- Hybrid scoring: fetch a larger pool and rank with time-decay in JS ---
    // We fetch (limit * 5) candidates sorted loosely by recency so we have enough
    // variety, then re-rank them with a HN-style score and splice in a "freshness
    // boost" slot for posts under 4 hours old that haven't surfaced yet.
    const poolSize = Math.max(limit * 5, 100);

    let query = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_public", true)
      .eq("is_draft", false)
      // Broad recency window: last 30 days for the scoring pool
      .gte(
        "created_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (cursor) {
      query = query.lt("created_at", cursor).limit(poolSize);
    } else {
      query = query.range(offset, offset + poolSize - 1);
    }

    const { data: pool, error } = await query;
    if (error) throw error;
    if (!pool || pool.length === 0) return [];

    const now = Date.now();
    const GRAVITY = 1.5; // higher = faster decay for old posts

    const scored = pool.map((post: any) => {
      const ageHours = Math.max(
        (now - new Date(post.created_at).getTime()) / (1000 * 60 * 60),
        0,
      );
      const views = (post.views_count || 0) as number;
      const likes = (post.likes_count || 0) as number;
      const comments = (post.comments_count || 0) as number;
      const shares = (post.shares_count || 0) as number;
      // Engagement points: likes/comments/shares are worth more than passive views
      const engagement = likes * 3 + comments * 5 + shares * 4 + views * 0.1;
      // HN-style time-decay score; +2 prevents division-by-zero & gives new posts a head-start
      const score = engagement / Math.pow(ageHours + 2, GRAVITY);
      return { post, score, ageHours };
    });

    // Sort by score descending
    scored.sort((a: any, b: any) => b.score - a.score);

    // Freshness boost: pick up to 3 posts under 4 h old and inject them into positions 0-2
    const freshCandidates = scored.filter((s: any) => s.ageHours < 4);
    const boosted: any[] = [];
    for (let i = 0; i < Math.min(3, freshCandidates.length); i++) {
      boosted.push(freshCandidates[i]);
    }
    // Fill remaining slots from the scored list (skip already-boosted)
    const boostedPostIds = new Set(boosted.map((s: any) => s.post.id));
    for (const s of scored) {
      if (boosted.length >= limit) break;
      if (!boostedPostIds.has(s.post.id)) boosted.push(s);
    }

    const ranked = boosted.slice(0, limit).map((s: any) => s.post);

    const normalizedData = ranked.map((post: any) =>
      this.normalizePostMedia(post),
    );
    const userIds = [...new Set(ranked.map((p: any) => p.user_id))];
    const { data: users } = await this.client
      .from("users")
      .select("id, username, full_name, profile_image_url, is_verified")
      .in("id", userIds);
    const userMap = new Map((users || []).map((u: any) => [u.id, u]));
    return normalizedData.map((post: any) => ({
      ...post,
      user: userMap.get(post.user_id) || null,
    }));
  }

  /**
   * Get reels feed: mixed media posts (video + image, slim select, cursor pagination)
   */
  async getReelsPosts(
    limit = 20,
    offset = 0,
    cursor?: string,
    createdAfter?: string,
  ) {
    let query = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_public", true)
      .eq("is_draft", false)
      // Reels supports both videos and image posts in the app.
      .or(
        [
          "post_type.eq.video",
          "post_type.eq.image",
          "video_url.not.is.null",
          "video_path.not.is.null",
          "stream_uid.not.is.null",
          "image_urls.not.is.null",
        ].join(","),
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (createdAfter) {
      query = query.gt("created_at", createdAfter).limit(limit);
    } else if (cursor) {
      query = query.lt("created_at", cursor).limit(limit);
    } else {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      const normalizedData = data.map((post: any) =>
        this.normalizePostMedia(post),
      );
      const userIds = [...new Set(data.map((p: any) => p.user_id))];
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", userIds);
      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      return normalizedData.map((post: any) => ({
        ...post,
        user: userMap.get(post.user_id) || null,
      }));
    }
    return (data || []).map((post: any) => this.normalizePostMedia(post));
  }

  /**
   * Old Gems feed: oldest video posts first, with one trending video inserted
   * after every five old videos. This keeps nostalgia content focused while
   * still surfacing strong evergreen posts.
   */
  async getOldGemsReelsPosts(limit = 20, offset = 0, cursor?: string) {
    const oldCutoff = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const videoFilter = [
      "post_type.eq.video",
      "video_url.not.is.null",
      "video_path.not.is.null",
      "stream_uid.not.is.null",
    ].join(",");

    let oldQuery = this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_public", true)
      .eq("is_draft", false)
      .or(videoFilter)
      .lte("created_at", oldCutoff)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (cursor) {
      oldQuery = oldQuery.gt("created_at", cursor).limit(limit);
    } else {
      oldQuery = oldQuery.range(offset, offset + limit - 1);
    }

    const { data: oldPosts, error: oldError } = await oldQuery;
    if (oldError) throw oldError;

    // If the app does not yet have 30-day-old videos, fall back to the oldest
    // available videos so the page is still useful during launch.
    let oldPool = oldPosts || [];
    if (oldPool.length === 0 && !cursor) {
      const { data: fallbackOld, error: fallbackError } = await this.client
        .from("posts")
        .select(SupabaseService.FEED_POST_SELECT)
        .eq("is_public", true)
        .eq("is_draft", false)
        .or(videoFilter)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + limit - 1);
      if (fallbackError) throw fallbackError;
      oldPool = fallbackOld || [];
    }

    const trendingSlots = Math.max(1, Math.ceil(limit / 6));
    const { data: trendingPool, error: trendingError } = await this.client
      .from("posts")
      .select(SupabaseService.FEED_POST_SELECT)
      .eq("is_public", true)
      .eq("is_draft", false)
      .or(videoFilter)
      .order("likes_count", { ascending: false, nullsFirst: false })
      .order("views_count", { ascending: false, nullsFirst: false })
      .order("shares_count", { ascending: false, nullsFirst: false })
      .limit(trendingSlots + 4);
    if (trendingError) throw trendingError;

    const oldIds = new Set(oldPool.map((post: any) => post.id));
    const trendingQueue = (trendingPool || []).filter(
      (post: any) => !oldIds.has(post.id),
    );
    const mixed: any[] = [];

    for (let i = 0; i < oldPool.length && mixed.length < limit; i++) {
      mixed.push({ ...oldPool[i], _feed_source: "old_gem" });
      if (
        (i + 1) % 5 === 0 &&
        trendingQueue.length > 0 &&
        mixed.length < limit
      ) {
        mixed.push({ ...trendingQueue.shift(), _feed_source: "trending_gem" });
      }
    }

    const normalizedData = mixed.map((post: any) =>
      this.normalizePostMedia(post),
    );
    const userIds = [
      ...new Set(mixed.map((p: any) => p.user_id).filter(Boolean)),
    ];
    if (userIds.length === 0) return normalizedData;

    const { data: users } = await this.client
      .from("users")
      .select("id, username, full_name, profile_image_url, is_verified")
      .in("id", userIds);
    const userMap = new Map((users || []).map((u: any) => [u.id, u]));

    return normalizedData.map((post: any) => ({
      ...post,
      user: userMap.get(post.user_id) || null,
    }));
  }

  // ===== Like/Save Status =====

  async getPostInteractionStatus(postId: string, userId: string) {
    const [likeResult, saveResult] = await Promise.all([
      this.client
        .from("post_likes")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", userId)
        .maybeSingle(),
      this.client
        .from("post_saves")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    return {
      isLiked: !!likeResult.data,
      isSaved: !!saveResult.data,
    };
  }

  async getPostInteractionStatusBatch(postIds: string[], userId: string) {
    if (postIds.length === 0) {
      return new Map<string, { isLiked: boolean; isSaved: boolean }>();
    }

    const [likesResult, savesResult] = await Promise.all([
      this.client
        .from("post_likes")
        .select("post_id")
        .eq("user_id", userId)
        .in("post_id", postIds),
      this.client
        .from("post_saves")
        .select("post_id")
        .eq("user_id", userId)
        .in("post_id", postIds),
    ]);

    if (likesResult.error) throw likesResult.error;
    if (savesResult.error) throw savesResult.error;

    const likedIds = new Set(
      (likesResult.data || []).map((r: any) => r.post_id),
    );
    const savedIds = new Set(
      (savesResult.data || []).map((r: any) => r.post_id),
    );

    const statusMap = new Map<string, { isLiked: boolean; isSaved: boolean }>();
    for (const postId of postIds) {
      statusMap.set(postId, {
        isLiked: likedIds.has(postId),
        isSaved: savedIds.has(postId),
      });
    }
    return statusMap;
  }

  // ===== Following =====

  async getFollowingIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId);

    if (error) throw error;
    return (data || []).map((f) => f.following_id);
  }

  async getFollowingPosts(userId: string, limit = 20, offset = 0) {
    const followingIds = await this.getFollowingIds(userId);
    if (followingIds.length === 0) return [];

    const { data, error } = await this.client
      .from("posts")
      .select("*")
      .in("user_id", followingIds)
      .eq("is_public", true)
      .eq("is_draft", false) // Exclude drafts
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map((p) => p.user_id))];
      const { data: users } = await this.client
        .from("users")
        .select("id, username, full_name, profile_image_url, is_verified")
        .in("id", userIds);

      const userMap = new Map((users || []).map((u) => [u.id, u]));
      return data.map((post) => ({
        ...post,
        user: userMap.get(post.user_id) || null,
      }));
    }

    return data;
  }

  // ===== Products =====

  async getProducts(options: {
    limit?: number;
    offset?: number;
    category?: string;
    sellerId?: string;
  }) {
    let query = this.client
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.sellerId) {
      query = query.eq("user_id", options.sellerId);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 20) - 1,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    if (data && data.length > 0) {
      const sellerIds = [
        ...new Set(data.map((p) => p.user_id).filter(Boolean)),
      ];
      if (sellerIds.length > 0) {
        const { data: sellers } = await this.client
          .from("users")
          .select("id, username, full_name, profile_image_url, is_verified")
          .in("id", sellerIds);

        const sellerMap = new Map((sellers || []).map((s) => [s.id, s]));
        return data.map((product) => ({
          ...product,
          seller: sellerMap.get(product.user_id) || null,
        }));
      }
    }

    return data;
  }

  async getShops(
    options: {
      limit?: number;
      offset?: number;
      category?: string;
    } = {},
  ) {
    let query = this.client
      .from("shops")
      .select(
        `
        *,
        users:user_id(id, username, full_name, profile_image_url)
      `,
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (options.category) {
      query = query.eq("category", options.category);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 20) - 1,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get product counts for each shop in batch
    if (data && data.length > 0) {
      const shopIds = data.map((s) => s.id);

      // Get all product counts in one query
      const { data: productCounts } = await this.client
        .from("products")
        .select("shop_id")
        .eq("is_active", true)
        .in("shop_id", shopIds);

      // Count products per shop
      const countsMap = new Map<string, number>();
      (productCounts || []).forEach((p: any) => {
        countsMap.set(p.shop_id, (countsMap.get(p.shop_id) || 0) + 1);
      });

      // Add product_count to each shop
      return data.map((shop: any) => ({
        ...shop,
        product_count: countsMap.get(shop.id) || 0,
      }));
    }

    return data || [];
  }

  // ===== Notifications =====

  async createNotification(data: {
    userId: string;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
    actorId?: string;
    actorUsername?: string;
    actorAvatar?: string;
    postId?: string;
    postThumbnail?: string;
    liveId?: string;
    communityId?: string;
  }) {
    const { error } = await this.client.from("notifications").insert({
      user_id: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      actor_id: data.actorId,
      actor_username: data.actorUsername,
      actor_avatar: data.actorAvatar,
      post_id: data.postId,
      post_thumbnail: data.postThumbnail,
      live_id: data.liveId,
      community_id: data.communityId,
      data: data.data || {},
      is_read: false,
    });

    if (error) throw error;
  }

  // ===== Live Sessions =====

  async getLiveSessions(limit = 20) {
    const { data, error } = await this.client
      .from("live_sessions")
      .select("*")
      .eq("status", "live")
      .order("viewer_count", { ascending: false })
      .limit(limit);

    if (error) throw error;

    if (data && data.length > 0) {
      const hostIds = [...new Set(data.map((s) => s.host_id).filter(Boolean))];
      if (hostIds.length > 0) {
        const { data: hosts } = await this.client
          .from("users")
          .select("id, username, full_name, profile_image_url, is_verified")
          .in("id", hostIds);

        const hostMap = new Map((hosts || []).map((h) => [h.id, h]));
        return data.map((session) => ({
          ...session,
          host: hostMap.get(session.host_id) || null,
        }));
      }
    }

    return data;
  }

  async createLiveSession(data: {
    hostId: string;
    channelName: string;
    title?: string;
  }) {
    const { data: session, error } = await this.client
      .from("live_sessions")
      .insert({
        host_id: data.hostId,
        channel_name: data.channelName,
        title: data.title || "Live Stream",
        status: "live",
        viewer_count: 0,
        heart_count: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return session;
  }

  async updateLiveSession(
    sessionId: string,
    data: Partial<{
      status: string;
      viewerCount: number;
      heartCount: number;
    }>,
  ) {
    const updateData: Record<string, any> = {};
    if (data.status) updateData.status = data.status;
    if (data.viewerCount !== undefined)
      updateData.viewer_count = data.viewerCount;
    if (data.heartCount !== undefined) updateData.heart_count = data.heartCount;

    const { error } = await this.client
      .from("live_sessions")
      .update(updateData)
      .eq("id", sessionId);

    if (error) throw error;
  }

  async endLiveSession(sessionId: string) {
    const { error } = await this.client
      .from("live_sessions")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error) throw error;
  }

  // ===== Comment Operations =====

  async getBlockedUserIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from("blocked_users")
      .select("blocked_user_id")
      .eq("user_id", userId);

    if (error) return [];
    return (data || []).map((b: any) => b.blocked_user_id);
  }

  async getComments(
    postId: string,
    options: {
      limit?: number;
      offset?: number;
    },
  ) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    const { data, error } = await this.client
      .from("comments")
      .select(
        `
        id,
        post_id,
        user_id,
        content,
        likes_count,
        replies_count,
        created_at,
        updated_at,
        users:user_id(id, full_name, username, profile_image_url, is_deactivated, is_verified)
      `,
      )
      .eq("post_id", postId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async getCommentReplies(commentIds: string[]) {
    if (commentIds.length === 0) return [];

    const { data, error } = await this.client
      .from("comment_replies")
      .select(
        `
        id,
        comment_id,
        user_id,
        content,
        likes_count,
        created_at,
        users:user_id(id, full_name, username, profile_image_url, is_deactivated, is_verified)
      `,
      )
      .in("comment_id", commentIds)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async getLikedCommentIds(
    userId: string,
    commentIds: string[],
  ): Promise<string[]> {
    if (commentIds.length === 0) return [];

    const { data, error } = await this.client
      .from("comment_likes")
      .select("comment_id")
      .eq("user_id", userId)
      .in("comment_id", commentIds);

    if (error) return [];
    return (data || []).map((l: any) => l.comment_id);
  }

  async addComment(postId: string, userId: string, content: string) {
    const { data, error } = await this.client
      .from("comments")
      .insert({
        post_id: postId,
        user_id: userId,
        content,
      })
      .select(
        `
        id,
        post_id,
        user_id,
        content,
        likes_count,
        replies_count,
        created_at,
        users:user_id(id, full_name, username, profile_image_url, is_verified)
      `,
      )
      .single();

    if (error) throw error;
    return data;
  }

  async deleteComment(commentId: string) {
    const { error } = await this.client
      .from("comments")
      .delete()
      .eq("id", commentId);

    if (error) throw error;
  }

  async likeComment(commentId: string, userId: string) {
    const { error } = await this.client.from("comment_likes").insert({
      comment_id: commentId,
      user_id: userId,
    });

    if (error) throw error;
  }

  async unlikeComment(commentId: string, userId: string) {
    const { error } = await this.client
      .from("comment_likes")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);

    if (error) throw error;
  }
}
