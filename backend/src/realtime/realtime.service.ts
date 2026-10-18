import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export interface LeadEvent {
  id: string;
  name?: string;
  status?: string;
  source?: string;
  ownerId?: string | null;
  reason?: string;
}

/**
 * Thin emit API used by domain services. The Socket.IO server is attached by the
 * gateway in `afterInit`, so services never depend on the transport directly (Q11, Q14).
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToWorkspace(workspaceId: string, event: string, payload: unknown): void {
    this.server?.to(`ws:${workspaceId}`).emit(event, payload);
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  emitLead(workspaceId: string, event: string, lead: LeadEvent): void {
    const payload = { ...lead, at: new Date().toISOString() };
    this.emitToWorkspace(workspaceId, event, payload);
    if (lead.ownerId) {
      this.emitToUser(lead.ownerId, event, payload);
    }
  }
}
