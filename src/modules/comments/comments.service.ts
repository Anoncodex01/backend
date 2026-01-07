import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../core/redis/redis.service';
import { SupabaseService } from '../../core/supabase/supabase.service';

@Injectable()
export class CommentsService {
  private commentsTtl: number;

  constructor(
    private redisService: RedisService,
    private supabaseService: SupabaseService,
    private configService: ConfigService,
  ) {
    // Cache comments for 5 minutes (they update frequently)
    this.commentsTtl = this.configService.get('CACHE_COMMENTS_TTL', 300);
  }

  /**
   * Get comments for a post with Redis caching
   * Returns cached data instantly, then refreshes in background
   */
  async getComments(postId: string, options: {
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const cacheKey = `comments:${postId}:${offset}:${limit}`;

    // Try to get from cache first
    let comments = await this.redisService.getJson<any[]>(cacheKey);

    if (!comments) {
      // Cache miss - fetch from database
      comments = await this.fetchCommentsFromDb(postId, options);
      
      // Cache the result
      await this.redisService.setJson(cacheKey, comments, this.commentsTtl);
    } else {
      // Cache hit - refresh in background (don't await)
      this.refreshCommentsInBackground(postId, options, cacheKey).catch(err => {
        console.error('Background refresh error:', err);
      });
    }

    return comments;
  }

  /**
   * Fetch comments from database
   */
  private async fetchCommentsFromDb(postId: string, options: {
    userId?: string;
    limit?: number;
    offset?: number;
  }) {
    // Get blocked user IDs if user is authenticated
    let blockedUserIds: string[] = [];
    if (options.userId) {
      blockedUserIds = await this.supabaseService.getBlockedUserIds(options.userId);
    }

    // Fetch comments with user info
    const limit = options.limit || 20;
    const offset = options.offset || 0;
    const fetchLimit = limit + blockedUserIds.length + 10; // Fetch extra to account for filtered users

    const comments = await this.supabaseService.getComments(postId, {
      limit: fetchLimit,
      offset,
    });

    // Filter out blocked/deactivated users
    const visibleComments = comments.filter((comment: any) => {
      const commentUserId = comment.user_id;
      const user = comment.users;
      const isDeactivated = user?.is_deactivated === true;

      if (commentUserId && blockedUserIds.includes(commentUserId)) return false;
      if (isDeactivated) return false;

      return true;
    }).slice(0, limit); // Take only the requested limit

    // Get comment IDs for replies
    const commentIds = visibleComments.map((c: any) => c.id);

    // Fetch replies in batch
    let replies: any[] = [];
    if (commentIds.length > 0) {
      replies = await this.supabaseService.getCommentReplies(commentIds);
      
      // Filter replies from blocked/deactivated users
      const visibleReplies = replies.filter((reply: any) => {
        const replyUserId = reply.user_id;
        const user = reply.users;
        const isDeactivated = user?.is_deactivated === true;

        if (replyUserId && blockedUserIds.includes(replyUserId)) return false;
        if (isDeactivated) return false;

        return true;
      });

      // Attach replies to comments
      const repliesMap = new Map<string, any[]>();
      visibleReplies.forEach((reply: any) => {
        // Ensure both 'user' and 'users' keys exist for compatibility
        if (reply.users && !reply.user) {
          reply.user = reply.users;
        }
        if (!repliesMap.has(reply.comment_id)) {
          repliesMap.set(reply.comment_id, []);
        }
        repliesMap.get(reply.comment_id)!.push(reply);
      });

      visibleComments.forEach((comment: any) => {
        comment._replies = repliesMap.get(comment.id) || [];
        // Ensure both 'user' and 'users' keys exist for compatibility
        if (comment.users && !comment.user) {
          comment.user = comment.users;
        }
      });
    }

    // Get like status if user is authenticated
    if (options.userId && commentIds.length > 0) {
      const likedCommentIds = await this.supabaseService.getLikedCommentIds(
        options.userId,
        commentIds,
      );
      
      visibleComments.forEach((comment: any) => {
        comment.is_liked = likedCommentIds.includes(comment.id);
        // Ensure both 'user' and 'users' keys exist for compatibility
        if (comment.users && !comment.user) {
          comment.user = comment.users;
        }
      });
    }

    return visibleComments;
  }

  /**
   * Refresh comments in background (non-blocking)
   */
  private async refreshCommentsInBackground(
    postId: string,
    options: any,
    cacheKey: string,
  ) {
    try {
      const freshComments = await this.fetchCommentsFromDb(postId, options);
      await this.redisService.setJson(cacheKey, freshComments, this.commentsTtl);
    } catch (error) {
      // Silently fail - cache is still valid
      console.error('Background refresh failed:', error);
    }
  }

  /**
   * Invalidate comments cache for a post
   */
  async invalidateCommentsCache(postId: string) {
    const pattern = `comments:${postId}:*`;
    await this.redisService.deletePattern(pattern);
  }

  /**
   * Add a comment (invalidates cache)
   */
  async addComment(postId: string, userId: string, content: string) {
    const comment = await this.supabaseService.addComment(postId, userId, content);
    
    // Invalidate cache
    await this.invalidateCommentsCache(postId);
    
    return comment;
  }

  /**
   * Delete a comment (invalidates cache)
   */
  async deleteComment(commentId: string, postId: string) {
    await this.supabaseService.deleteComment(commentId);
    
    // Invalidate cache
    await this.invalidateCommentsCache(postId);
  }

  /**
   * Like/unlike a comment
   */
  async toggleCommentLike(commentId: string, userId: string, isLiked: boolean) {
    if (isLiked) {
      await this.supabaseService.unlikeComment(commentId, userId);
    } else {
      await this.supabaseService.likeComment(commentId, userId);
    }
  }
}

