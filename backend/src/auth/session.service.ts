import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Role, Session, User } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

const IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_AFTER_MS = 5 * 60 * 1000;

export type ResolvedSession = Session & { user: User & { role: Role | null } };

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
        idleExpiresAt: new Date(Date.now() + IDLE_TTL_MS),
        absoluteExpiresAt: new Date(Date.now() + ABSOLUTE_TTL_MS),
      },
    });
    return { token, session };
  }

  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { role: true } } },
    });
    if (!session || session.revokedAt || !session.user.isActive) {
      return null;
    }

    const now = Date.now();
    if (session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now) {
      return null;
    }

    if (now - session.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastUsedAt: new Date(now),
          idleExpiresAt: new Date(
            Math.min(now + IDLE_TTL_MS, session.absoluteExpiresAt.getTime()),
          ),
        },
      });
    }

    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
