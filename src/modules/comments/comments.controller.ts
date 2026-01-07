import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  UseGuards,
} from '@nestjs/common';
import { CommentsService } from './comments.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuthService } from '../auth/auth.service';

@Controller('comments')
export class CommentsController {
  constructor(
    private commentsService: CommentsService,
    private authService: AuthService,
  ) {}

  /**
   * GET /v1/comments/:postId
   * Get comments for a post (cached with Redis)
   */
  @Get(':postId')
  async getComments(
    @Param('postId') postId: string,
    @Query('limit') limit: number = 20,
    @Query('offset') offset: number = 0,
    @Headers('authorization') authHeader?: string,
  ) {
    // Extract user ID if authenticated
    let userId: string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await this.authService.verifySupabaseToken(token);
        userId = payload.sub;
      } catch {
        // Continue as anonymous
      }
    }

    const comments = await this.commentsService.getComments(postId, {
      userId,
      limit,
      offset,
    });

    return {
      success: true,
      data: comments || [],
      meta: {
        postId,
        limit,
        offset,
        count: comments?.length || 0,
      },
    };
  }

  /**
   * POST /v1/comments/:postId
   * Add a comment
   */
  @Post(':postId')
  @UseGuards(AuthGuard)
  async addComment(
    @Param('postId') postId: string,
    @Body('content') content: string,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader.replace('Bearer ', '');
    const payload = await this.authService.verifySupabaseToken(token);
    const userId = payload.sub;

    const comment = await this.commentsService.addComment(postId, userId, content);

    return {
      success: true,
      data: comment,
    };
  }

  /**
   * DELETE /v1/comments/:commentId
   * Delete a comment
   */
  @Delete(':commentId')
  @UseGuards(AuthGuard)
  async deleteComment(
    @Param('commentId') commentId: string,
    @Query('postId') postId: string,
  ) {
    await this.commentsService.deleteComment(commentId, postId);

    return {
      success: true,
    };
  }

  /**
   * POST /v1/comments/:commentId/like
   * Like/unlike a comment
   */
  @Post(':commentId/like')
  @UseGuards(AuthGuard)
  async toggleLike(
    @Param('commentId') commentId: string,
    @Body('isLiked') isLiked: boolean,
    @Headers('authorization') authHeader: string,
  ) {
    const token = authHeader.replace('Bearer ', '');
    const payload = await this.authService.verifySupabaseToken(token);
    const userId = payload.sub;

    await this.commentsService.toggleCommentLike(commentId, userId, isLiked);

    return {
      success: true,
    };
  }
}

