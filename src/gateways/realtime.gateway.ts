import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../core/redis/redis.service';
import { LiveService } from '../modules/live/live.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  currentRoom?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  path: '/socket',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private liveService: LiveService,
  ) {}

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        console.log('WebSocket: No token provided, disconnecting');
        client.disconnect();
        return;
      }

      // Verify Supabase JWT
      const secret = this.configService.get('SUPABASE_JWT_SECRET');
      const payload = this.jwtService.verify(token, { secret });

      client.userId = payload.sub;
      console.log(`WebSocket: User ${client.userId} connected`);

      // Track online status
      if (client.userId) {
        await this.redisService.sadd('online_users', client.userId);
        await this.redisService.hset('user_sockets', client.userId, client.id);
      }

    } catch (error) {
      console.log('WebSocket: Invalid token, disconnecting');
      client.disconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      console.log(`WebSocket: User ${client.userId} disconnected`);

      // Remove from online users
      await this.redisService.srem('online_users', client.userId);
      await this.redisService.hdel('user_sockets', client.userId);

      // Leave current room if any
      if (client.currentRoom) {
        await this.handleLeaveLive(client, { liveId: client.currentRoom });
      }
    }
  }

  /**
   * Join a live session room
   */
  @SubscribeMessage('join_live')
  async handleJoinLive(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { liveId: string },
  ) {
    if (!client.userId) return;

    const roomName = `live:${data.liveId}`;

    // Leave previous room
    if (client.currentRoom) {
      client.leave(`live:${client.currentRoom}`);
      await this.liveService.leaveLiveSession(client.currentRoom, client.userId);
    }

    // Join new room
    client.join(roomName);
    client.currentRoom = data.liveId;

    // Add viewer
    await this.redisService.sadd(`live:${data.liveId}:viewer_set`, client.userId);
    const viewerCount = await this.redisService.scard(`live:${data.liveId}:viewer_set`);
    await this.redisService.set(`live:${data.liveId}:viewers`, viewerCount.toString());

    // Broadcast updated viewer count to room
    this.server.to(roomName).emit('viewer_update', {
      liveId: data.liveId,
      viewerCount,
    });

    // Notify room about new viewer
    this.server.to(roomName).emit('user_joined', {
      liveId: data.liveId,
      userId: client.userId,
      viewerCount,
    });

    return { success: true, viewerCount };
  }

  /**
   * Leave a live session room
   */
  @SubscribeMessage('leave_live')
  async handleLeaveLive(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { liveId: string },
  ) {
    if (!client.userId) return;

    const roomName = `live:${data.liveId}`;

    // Leave room
    client.leave(roomName);
    client.currentRoom = undefined;

    // Remove viewer
    await this.redisService.srem(`live:${data.liveId}:viewer_set`, client.userId);
    const viewerCount = await this.redisService.scard(`live:${data.liveId}:viewer_set`);
    await this.redisService.set(`live:${data.liveId}:viewers`, viewerCount.toString());

    // Broadcast updated viewer count
    this.server.to(roomName).emit('viewer_update', {
      liveId: data.liveId,
      viewerCount,
    });

    return { success: true, viewerCount };
  }

  /**
   * Send a heart (with rate limiting)
   */
  @SubscribeMessage('heart')
  async handleHeart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { liveId: string },
  ) {
    if (!client.userId) return;

    // Rate limit: max 5 hearts per second
    const rateLimitKey = `live:${data.liveId}:heart_limit:${client.userId}`;
    const allowed = await this.redisService.rateLimit(rateLimitKey, 5, 1);

    if (!allowed) {
      return { success: false, message: 'Rate limited' };
    }

    // Increment heart count
    const heartCount = await this.redisService.incr(`live:${data.liveId}:hearts`);

    // Broadcast heart to room
    const roomName = `live:${data.liveId}`;
    this.server.to(roomName).emit('heart_received', {
      liveId: data.liveId,
      userId: client.userId,
      heartCount,
    });

    return { success: true, heartCount };
  }

  /**
   * Send a live comment
   */
  @SubscribeMessage('comment')
  async handleComment(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { liveId: string; text: string; username?: string },
  ) {
    if (!client.userId || !data.text?.trim()) return;

    // Rate limit comments: max 10 per minute
    const rateLimitKey = `live:${data.liveId}:comment_limit:${client.userId}`;
    const allowed = await this.redisService.rateLimit(rateLimitKey, 10, 60);

    if (!allowed) {
      return { success: false, message: 'Rate limited' };
    }

    const comment = {
      id: `${Date.now()}_${client.userId}`,
      userId: client.userId,
      username: data.username || 'User',
      text: data.text.trim().substring(0, 500), // Max 500 chars
      timestamp: Date.now(),
    };

    // Broadcast comment to room
    const roomName = `live:${data.liveId}`;
    this.server.to(roomName).emit('comment_received', {
      liveId: data.liveId,
      comment,
    });

    return { success: true, comment };
  }

  /**
   * Typing indicator (for chat)
   */
  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { recipientId: string; isTyping: boolean },
  ) {
    if (!client.userId) return;

    // Get recipient's socket
    const recipientSocketId = await this.redisService.hget('user_sockets', data.recipientId);

    if (recipientSocketId) {
      this.server.to(recipientSocketId).emit('user_typing', {
        userId: client.userId,
        isTyping: data.isTyping,
      });
    }

    return { success: true };
  }

  /**
   * Check if user is online
   */
  @SubscribeMessage('check_online')
  async handleCheckOnline(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { userIds: string[] },
  ) {
    const onlineStatus: Record<string, boolean> = {};

    for (const userId of data.userIds) {
      onlineStatus[userId] = await this.redisService.sismember('online_users', userId);
    }

    return { success: true, onlineStatus };
  }

  /**
   * Broadcast live session ended
   */
  async broadcastLiveEnded(liveId: string, stats: { viewerCount: number; heartCount: number }) {
    const roomName = `live:${liveId}`;
    this.server.to(roomName).emit('live_ended', {
      liveId,
      stats,
    });
  }

  /**
   * Broadcast to specific user
   */
  async sendToUser(userId: string, event: string, data: any) {
    const socketId = await this.redisService.hget('user_sockets', userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}

