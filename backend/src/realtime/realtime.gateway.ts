import { Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/session.service';
import { RealtimeService } from './realtime.service';

/** Rejects a handshake whose Origin is not the configured web app (Q3, Q11). */
function allowedOrigin(origin: string | undefined): boolean {
  const allowed = (process.env.WEB_URL ?? 'http://localhost:3000').split(',');
  return !origin || allowed.includes(origin);
}

@WebSocketGateway({
  transports: ['websocket'],
  cors: {
    origin: (origin, callback) => callback(null, allowedOrigin(origin ?? undefined)),
    credentials: true,
  },
})
@Injectable()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(): void {
    this.realtime.setServer(this.server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      client.disconnect(true);
      return;
    }
    client.data.userId = session.userId;
    client.data.workspaceId = session.user.workspaceId;
    await client.join(`user:${session.userId}`);
    await client.join(`ws:${session.user.workspaceId}`);
  }

  handleDisconnect(): void {
    // Socket.IO removes the socket from its rooms automatically.
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) {
      return fromAuth;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }
    const query = client.handshake.query?.token;
    return typeof query === 'string' && query ? query : null;
  }
}
