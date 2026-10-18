import { EventEmitter } from 'node:events';

import { Injectable, Logger } from '@nestjs/common';

/**
 * In-process domain events so modules stay decoupled (Q14): workspaces emits, leads listens, etc.
 * Handlers run asynchronously; failures are logged and never propagate to the emitter.
 */
export type DomainEventMap = {
  'user.availability_changed': { workspaceId: string; userId: string; from: string; to: string; actorId: string | null };
  'user.deactivated': { workspaceId: string; userId: string; actorId: string | null };
  'lead.activity': { workspaceId: string; leadId: string; actorId: string | null; type: string };
  'opportunity.activity': { workspaceId: string; opportunityId: string; actorId: string | null; type: string };
};

@Injectable()
export class DomainEvents {
  private readonly emitter = new EventEmitter();
  private readonly logger = new Logger(DomainEvents.name);

  emit<K extends keyof DomainEventMap>(event: K, payload: DomainEventMap[K]) {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DomainEventMap>(event: K, handler: (payload: DomainEventMap[K]) => Promise<void> | void) {
    this.emitter.on(event, (payload: DomainEventMap[K]) => {
      Promise.resolve(handler(payload)).catch((error) => this.logger.error(`Handler for ${event} failed: ${(error as Error).message}`));
    });
  }
}
