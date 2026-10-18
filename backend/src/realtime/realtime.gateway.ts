import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { AuthService } from '../auth/auth.service';
import { loadEnv } from '../common/env';

export const SOCKET_EVENTS = [
  'lead:created',
  'lead:assigned',
  'lead:acknowledged',
  'lead:escalated',
  'lead:reassigned',
  'lead:updated',
  'lead:recovery',
  'message:new',
  'message:status',
  'payment:updated',
  'appointment:updated',
  'availability:changed',
  'integration:status',
  'notification', // personal: { title, body, link }
] as const;

export type SocketEvent = (typeof SOCKET_EVENTS)[number];

/**
 * Real-time push (Q11). Clients authenticate in the handshake with the 60-second token from
 * GET /auth/ws-token (Nest does not await async handleConnection, so auth happens in io.use()).
 * Rooms: ws:<workspaceId> for everyone in the workspace, user:<userId> for personal notifications.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: loadEnv().CORS_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly auth: AuthService) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: string })?.token ?? (socket.handshake.query.token as string | undefined);
      const identity = token ? this.auth.verifyWsToken(token) : null;
      if (!identity) return next(new Error('unauthorized'));
      socket.data.userId = identity.userId;
      socket.data.workspaceId = identity.workspaceId;
      next();
    });
    server.on('connection', (socket: Socket) => {
      void socket.join([`ws:${socket.data.workspaceId}`, `user:${socket.data.userId}`]);
      socket.emit('ready', { userId: socket.data.userId, workspaceId: socket.data.workspaceId, events: SOCKET_EVENTS });
    });
    this.logger.log('Socket.IO gateway ready');
  }

  toWorkspace(workspaceId: string, event: SocketEvent, payload: unknown) {
    this.server?.to(`ws:${workspaceId}`).emit(event, payload);
  }

  toUser(userId: string, event: SocketEvent, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
