import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { toSessionUser } from './serializer';
import { SessionService } from './session.service';
import type { SessionUserProfile } from './types/session-user';

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class AuthService {
  /** A real hash verified when the account is missing, so timing cannot reveal which emails exist. */
  private readonly decoyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {
    this.decoyHash = argon2.hash(randomBytes(24).toString('hex'), ARGON2_OPTIONS);
  }

  async login(
    email: string,
    password: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; user: SessionUserProfile }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { role: true },
    });

    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? (await this.decoyHash),
      password,
    );

    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'That email and password combination is not recognised.',
        action: 'Check your details and try again.',
      });
    }

    const { token } = await this.sessions.create(user.id, meta);
    return { token, user: toSessionUser(user) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }
}
