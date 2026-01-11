import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface SupabaseOptions {
  url: string;
  serviceKey: string;
  jwtSecret: string;
}

@Injectable()
export class SupabaseService implements OnModuleInit {
  private client: SupabaseClient;
  private jwtSecret: string;

  constructor(@Inject('SUPABASE_OPTIONS') private options: SupabaseOptions) {}

  async onModuleInit() {
    this.client = createClient(this.options.url, this.options.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.jwtSecret = this.options.jwtSecret;
    console.log('✅ Supabase connected');
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
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data;
  }

  async getUserByUsername(username: string) {
    const { data, error } = await this.client
      .from('users')
      .select('*')
      .eq('username', username)
      .single();

    if (error) throw error;
    return data;
  }

  async getUserPosts(userId: string, options: {
    limit?: number;
    offset?: number;
    isPublic?: boolean;
  } = {}) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    let query = this.client
      .from('posts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_draft', false) // Exclude drafts - only owner can see their drafts on their own profile
      .order('created_at', { ascending: false });

    if (options.isPublic !== undefined) {
      query = query.eq('is_public', options.isPublic);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async getUserStats(userId: string) {
    const [postsResult, followersResult, followingResult] = await Promise.all([
      this.client.from('posts').select('id', { count: 'exact' }).eq('user_id', userId).eq('is_public', true).eq('is_draft', false),
      this.client.from('follows').select('id', { count: 'exact' }).eq('following_id', userId),
      this.client.from('follows').select('id', { count: 'exact' }).eq('follower_id', userId),
    ]);

    return {
      posts_count: postsResult.count || 0,
      followers_count: followersResult.count || 0,
      following_count: followingResult.count || 0,
    };
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const { data } = await this.client
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();
    return !!data;
  }

  async getFollowers(userId: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const followerIds = data.map(f => f.follower_id);
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', followerIds);
      return users || [];
    }
    return [];
  }

  async getFollowing(userId: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const followingIds = data.map(f => f.following_id);
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', followingIds);
      return users || [];
    }
    return [];
  }
  
  // ===== Search Operations =====
  
  async searchUsers(query: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('users')
      .select('id, username, full_name, profile_image_url')
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async searchPosts(query: string, limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('posts')
      .select('*')
      .eq('is_public', true)
      .eq('is_draft', false) // Exclude drafts
      .ilike('caption', `%${query}%`)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(p => p.user_id))];
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', userIds);
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      return data.map(post => ({
        ...post,
        user: userMap.get(post.user_id) || null
      }));
    }
    return data || [];
  }

  // ===== Community Operations =====
  
  async getCommunities(limit = 20, offset = 0) {
    const { data, error } = await this.client
      .from('communities')
      .select('*')
      .order('members_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async getCommunity(communityId: string) {
    const { data, error } = await this.client
      .from('communities')
      .select('*')
      .eq('id', communityId)
      .single();

    if (error) throw error;
    return data;
  }

  async isCommunityMember(communityId: string, userId: string): Promise<boolean> {
    const { data } = await this.client
      .from('community_members')
      .select('id')
      .eq('community_id', communityId)
      .eq('user_id', userId)
      .maybeSingle();
    return !!data;
  }

  // ===== Post Operations =====

  async getPosts(options: {
    limit?: number;
    offset?: number;
    userId?: string;
    isPublic?: boolean;
    orderBy?: string;
  }) {
    let query = this.client
      .from('posts')
      .select('*')
      .eq('is_draft', false) // Always exclude drafts from public feeds
      .order(options.orderBy || 'created_at', { ascending: false });

    if (options.userId) {
      query = query.eq('user_id', options.userId);
    }

    if (options.isPublic !== undefined) {
      query = query.eq('is_public', options.isPublic);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    // Enrich with user data
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(p => p.user_id))];
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', userIds);
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      return data.map(post => ({
        ...post,
        user: userMap.get(post.user_id) || null
      }));
    }
    
    return data;
  }

  async getPost(postId: string) {
    const { data, error } = await this.client
      .from('posts')
      .select('*')
      .eq('id', postId)
      .single();

    if (error) throw error;
    
    if (data && data.user_id) {
      const { data: user } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .eq('id', data.user_id)
        .single();
      return { ...data, user };
    }
    
    return data;
  }

  async getTrendingPosts(limit = 20) {
    const { data, error } = await this.client
      .from('posts')
      .select('*')
      .eq('is_public', true)
      .eq('is_draft', false) // Exclude drafts
      .order('views_count', { ascending: false })
      .order('likes_count', { ascending: false })
      .limit(limit);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(p => p.user_id))];
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', userIds);
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      return data.map(post => ({
        ...post,
        user: userMap.get(post.user_id) || null
      }));
    }
    
    return data;
  }

  // ===== Like/Save Status =====

  async getPostInteractionStatus(postId: string, userId: string) {
    const [likeResult, saveResult] = await Promise.all([
      this.client
        .from('post_likes')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', userId)
        .maybeSingle(),
      this.client
        .from('post_saves')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    return {
      isLiked: !!likeResult.data,
      isSaved: !!saveResult.data,
    };
  }

  // ===== Following =====

  async getFollowingIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);

    if (error) throw error;
    return (data || []).map((f) => f.following_id);
  }

  async getFollowingPosts(userId: string, limit = 20, offset = 0) {
    const followingIds = await this.getFollowingIds(userId);
    if (followingIds.length === 0) return [];

    const { data, error } = await this.client
      .from('posts')
      .select('*')
      .in('user_id', followingIds)
      .eq('is_public', true)
      .eq('is_draft', false) // Exclude drafts
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(p => p.user_id))];
      const { data: users } = await this.client
        .from('users')
        .select('id, username, full_name, profile_image_url')
        .in('id', userIds);
      
      const userMap = new Map((users || []).map(u => [u.id, u]));
      return data.map(post => ({
        ...post,
        user: userMap.get(post.user_id) || null
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
      .from('products')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (options.category) {
      query = query.eq('category', options.category);
    }

    if (options.sellerId) {
      query = query.eq('seller_id', options.sellerId);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error } = await query;
    if (error) throw error;
    
    if (data && data.length > 0) {
      const sellerIds = [...new Set(data.map(p => p.seller_id).filter(Boolean))];
      if (sellerIds.length > 0) {
        const { data: sellers } = await this.client
          .from('users')
          .select('id, username, full_name, profile_image_url')
          .in('id', sellerIds);
        
        const sellerMap = new Map((sellers || []).map(s => [s.id, s]));
        return data.map(product => ({
          ...product,
          seller: sellerMap.get(product.seller_id) || null
        }));
      }
    }
    
    return data;
  }

  async getShops(options: {
    limit?: number;
    offset?: number;
    category?: string;
  } = {}) {
    let query = this.client
      .from('shops')
      .select(`
        *,
        users:user_id(id, username, full_name, profile_image_url)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (options.category) {
      query = query.eq('category', options.category);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Get product counts for each shop in batch
    if (data && data.length > 0) {
      const shopIds = data.map(s => s.id);
      
      // Get all product counts in one query
      const { data: productCounts } = await this.client
        .from('products')
        .select('shop_id')
        .eq('is_active', true)
        .in('shop_id', shopIds);

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
  }) {
    const { error } = await this.client.from('notifications').insert({
      user_id: data.userId,
      type: data.type,
      title: data.title,
      body: data.body,
      data: data.data || {},
      is_read: false,
    });

    if (error) throw error;
  }

  // ===== Live Sessions =====

  async getLiveSessions(limit = 20) {
    const { data, error } = await this.client
      .from('live_sessions')
      .select('*')
      .eq('status', 'live')
      .order('viewer_count', { ascending: false })
      .limit(limit);

    if (error) throw error;
    
    if (data && data.length > 0) {
      const hostIds = [...new Set(data.map(s => s.host_id).filter(Boolean))];
      if (hostIds.length > 0) {
        const { data: hosts } = await this.client
          .from('users')
          .select('id, username, full_name, profile_image_url')
          .in('id', hostIds);
        
        const hostMap = new Map((hosts || []).map(h => [h.id, h]));
        return data.map(session => ({
          ...session,
          host: hostMap.get(session.host_id) || null
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
      .from('live_sessions')
      .insert({
        host_id: data.hostId,
        channel_name: data.channelName,
        title: data.title || 'Live Stream',
        status: 'live',
        viewer_count: 0,
        heart_count: 0,
      })
      .select()
      .single();

    if (error) throw error;
    return session;
  }

  async updateLiveSession(sessionId: string, data: Partial<{
    status: string;
    viewerCount: number;
    heartCount: number;
  }>) {
    const updateData: Record<string, any> = {};
    if (data.status) updateData.status = data.status;
    if (data.viewerCount !== undefined) updateData.viewer_count = data.viewerCount;
    if (data.heartCount !== undefined) updateData.heart_count = data.heartCount;

    const { error } = await this.client
      .from('live_sessions')
      .update(updateData)
      .eq('id', sessionId);

    if (error) throw error;
  }

  async endLiveSession(sessionId: string) {
    const { error } = await this.client
      .from('live_sessions')
      .update({ 
        status: 'ended',
        ended_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) throw error;
  }

  // ===== Comment Operations =====

  async getBlockedUserIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('blocked_users')
      .select('blocked_user_id')
      .eq('user_id', userId);

    if (error) return [];
    return (data || []).map((b: any) => b.blocked_user_id);
  }

  async getComments(postId: string, options: {
    limit?: number;
    offset?: number;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    const { data, error } = await this.client
      .from('comments')
      .select(`
        id,
        post_id,
        user_id,
        content,
        likes_count,
        replies_count,
        created_at,
        updated_at,
        users:user_id(id, full_name, username, profile_image_url, is_deactivated)
      `)
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  }

  async getCommentReplies(commentIds: string[]) {
    if (commentIds.length === 0) return [];

    const { data, error } = await this.client
      .from('comment_replies')
      .select(`
        id,
        comment_id,
        user_id,
        content,
        likes_count,
        created_at,
        users:user_id(id, full_name, username, profile_image_url, is_deactivated)
      `)
      .in('comment_id', commentIds)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  async getLikedCommentIds(userId: string, commentIds: string[]): Promise<string[]> {
    if (commentIds.length === 0) return [];

    const { data, error } = await this.client
      .from('comment_likes')
      .select('comment_id')
      .eq('user_id', userId)
      .in('comment_id', commentIds);

    if (error) return [];
    return (data || []).map((l: any) => l.comment_id);
  }

  async addComment(postId: string, userId: string, content: string) {
    const { data, error } = await this.client
      .from('comments')
      .insert({
        post_id: postId,
        user_id: userId,
        content,
      })
      .select(`
        id,
        post_id,
        user_id,
        content,
        likes_count,
        replies_count,
        created_at,
        users:user_id(id, full_name, username, profile_image_url)
      `)
      .single();

    if (error) throw error;
    return data;
  }

  async deleteComment(commentId: string) {
    const { error } = await this.client
      .from('comments')
      .delete()
      .eq('id', commentId);

    if (error) throw error;
  }

  async likeComment(commentId: string, userId: string) {
    const { error } = await this.client
      .from('comment_likes')
      .insert({
        comment_id: commentId,
        user_id: userId,
      });

    if (error) throw error;
  }

  async unlikeComment(commentId: string, userId: string) {
    const { error } = await this.client
      .from('comment_likes')
      .delete()
      .eq('comment_id', commentId)
      .eq('user_id', userId);

    if (error) throw error;
  }
}

