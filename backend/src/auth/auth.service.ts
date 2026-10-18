import { createHash } from 'node:crypto';

import { ConflictException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';

import { hmacSha256Hex, randomToken, safeEqual } from '../common/encryption';
import { ENV, type Env } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { type AuthContext } from './auth.types';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from './permissions';
import { openLeadCounts, toUserView, USER_SELECT } from '../workspaces/user-view';

// OWASP minimum Argon2id configuration; bounded memory under concurrent logins (Q1).
const ARGON2_OPTIONS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Constant-time behaviour for unknown emails: hash a dummy password anyway (OWASP Authentication Cheat Sheet).
const DUMMY_HASH_PROMISE = argon2.hash('dummy-password-for-timing', ARGON2_OPTIONS);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** F1.1: signing up creates a new workspace and makes the first user its Owner. */
  async signup(input: { workspaceName: string; firstName: string; lastName: string; email: string; password: string; timeZone?: string }, meta: RequestMeta) {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email already exists.', action: 'Log in instead, or use another email.' });

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const slug = await this.uniqueSlug(input.workspaceName);

    const { user, workspace } = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({ data: { name: input.workspaceName, slug, timeZone: input.timeZone ?? 'UTC' } });
      await tx.role.createMany({
        data: DEFAULT_ROLES.map((role) => ({ workspaceId: workspace.id, name: role.name, description: role.description, permissions: role.permissions, isSystem: true })),
      });
      const pipeline = await tx.pipeline.create({ data: { workspaceId: workspace.id, name: 'Sales pipeline', isDefault: true } });
      const stageNames: [string, Partial<{ isWon: boolean; isLost: boolean }>][] = [
        ['New', {}],
        ['Qualified', {}],
        ['Proposal', {}],
        ['Negotiation', {}],
        ['Won', { isWon: true }],
        ['Lost', { isLost: true }],
      ];
      await tx.pipelineStage.createMany({
        data: stageNames.map(([name, flags], index) => ({ workspaceId: workspace.id, pipelineId: pipeline.id, name, order: index, ...flags })),
      });
      const user = await tx.user.create({
        data: {
          workspaceId: workspace.id,
          email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          baseLevel: 'OWNER',
          availability: 'AVAILABLE',
          timeZone: input.timeZone ?? 'UTC',
        },
      });
      await this.audit.recordTx(tx, {
        workspaceId: workspace.id,
        actorId: user.id,
        actorLabel: `${user.firstName} ${user.lastName} <${user.email}>`,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: workspace.id,
        after: { name: workspace.name, slug },
      });
      return { user, workspace };
    });

    const session = await this.createSession(user.id, meta);
    return { token: session.token, expiresAt: session.expiresAt, user: this.publicUser(user), workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } };
  }

  async login(input: { email: string; password: string }, meta: RequestMeta) {
    const email = input.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email }, include: { workspace: true } });
    const hash = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
    const valid = await argon2.verify(hash, input.password);
    if (!user || !valid || !user.isActive) {
      // Same message and status for every failure (OWASP): no account enumeration.
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.', action: 'Check your details and try again.' });
    }
    if (argon2.needsRehash(hash, ARGON2_OPTIONS)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(input.password, ARGON2_OPTIONS) } });
    }
    const session = await this.createSession(user.id, meta);
    return { token: session.token, expiresAt: session.expiresAt, user: this.publicUser(user), workspace: { id: user.workspace.id, name: user.workspace.name, slug: user.workspace.slug } };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: result.count > 0 };
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, NOT: exceptSessionId ? { id: exceptSessionId } : undefined }, data: { revokedAt: new Date() } });
  }

  /**
   * Resolve a bearer token to an AuthContext. Idle expiry slides on use; absolute expiry does not (Q1).
   * Permissions are read fresh each request so a role change applies immediately.
   */
  async resolveSession(token: string, ip?: string): Promise<AuthContext | null> {
    const id = hashToken(token);
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { id },
      include: { user: { include: { role: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now || !session.user.isActive) return null;

    // Slide the idle window at most once a minute to avoid a write on every request.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.session.update({
        where: { id },
        data: { lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + this.env.SESSION_IDLE_HOURS * 3600_000), ip },
      });
    }
    const { user } = session;
    return {
      userId: user.id,
      workspaceId: user.workspaceId,
      sessionId: session.id,
      email: user.email,
      name: `${user.firstName} ${user.lastName}`.trim(),
      baseLevel: user.baseLevel,
      roleName: user.role?.name ?? null,
      permissions: new Set((user.role?.permissions ?? []) as Permission[]),
    };
  }

  /**
   * Full session for the app shell: the user as the members list shows them, the workspace, effective
   * permissions (Owner/Admin hold every permission, F1.2) and when the session expires.
   */
  async sessionView(auth: AuthContext) {
    const [user, workspace, session, counts] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: USER_SELECT }),
      this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId } }),
      this.prisma.session.findUnique({ where: { id: auth.sessionId }, select: { expiresAt: true } }),
      openLeadCounts(this.prisma, auth.workspaceId),
    ]);
    return {
      user: toUserView(user, counts.get(user.id) ?? 0),
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, timeZone: workspace.timeZone, currency: workspace.currency },
      permissions: auth.baseLevel === 'USER' ? [...auth.permissions] : Object.keys(PERMISSIONS),
      expiresAt: session?.expiresAt ?? null,
    };
  }

  /** Public: who an invite is for, so the page can greet them (F1.2). */
  async inviteInfo(token: string) {
    const user = await this.findInvite(token);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: user.workspaceId } });
    return { email: user.email, firstName: user.firstName, lastName: user.lastName, workspaceName: workspace.name };
  }

  /** Accepting an invite sets the member's own password, consumes the token and signs them in. */
  async acceptInvite(token: string, input: { name?: string; password: string }, meta: RequestMeta) {
    const user = await this.findInvite(token);
    const [firstName, ...rest] = (input.name ?? '').trim().split(/\s+/).filter(Boolean);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await argon2.hash(input.password, ARGON2_OPTIONS),
          inviteTokenHash: null,
          inviteExpiresAt: null,
          ...(firstName ? { firstName, lastName: rest.join(' ') || user.lastName } : {}),
        },
      });
      await this.audit.recordTx(tx, { workspaceId: user.workspaceId, actorId: user.id, actorLabel: user.email, action: 'user.invite_accepted', targetType: 'user', targetId: user.id, after: { email: user.email } });
    });
    const session = await this.createSession(user.id, meta);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: user.workspaceId } });
    return { token: session.token, expiresAt: session.expiresAt, user: this.publicUser(user), workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } };
  }

  private async findInvite(token: string) {
    const user = await this.prisma.user.findUnique({ where: { inviteTokenHash: hashToken(token) } });
    if (!user || !user.isActive || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'INVITE_INVALID', message: 'This invite link is invalid or has expired.', action: 'Ask your workspace Owner or Admin to send a new invite.' });
    }
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, sessionId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(newPassword, ARGON2_OPTIONS) } });
    await this.revokeAllSessions(userId, sessionId);
  }

  async hashPassword(password: string) {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  /** Short-lived token for the Socket.IO handshake (Q11); stateless HMAC so no Redis round trip. */
  issueWsToken(auth: AuthContext): string {
    const exp = Date.now() + 60_000;
    const payload = `${auth.userId}.${auth.workspaceId}.${exp}`;
    return `${payload}.${hmacSha256Hex(this.env.APP_ENCRYPTION_KEY, payload)}`;
  }

  verifyWsToken(token: string): { userId: string; workspaceId: string } | null {
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [userId, workspaceId, exp, signature] = parts;
    if (Number(exp) < Date.now()) return null;
    const expected = hmacSha256Hex(this.env.APP_ENCRYPTION_KEY, `${userId}.${workspaceId}.${exp}`);
    return safeEqual(expected, signature) ? { userId, workspaceId } : null;
  }

  private async createSession(userId: string, meta: RequestMeta) {
    const token = randomToken(32);
    const now = Date.now();
    const expiresAt = new Date(now + this.env.SESSION_ABSOLUTE_DAYS * 86_400_000);
    await this.prisma.session.create({
      data: {
        id: hashToken(token),
        userId,
        expiresAt,
        idleExpiresAt: new Date(now + this.env.SESSION_IDLE_HOURS * 3600_000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return { token, expiresAt };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'workspace';
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${randomToken(2)}`;
      if (!(await this.prisma.workspace.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${randomToken(4)}`;
  }

  publicUser(user: { id: string; email: string; firstName: string; lastName: string; baseLevel: string; roleId: string | null; availability: string; timeZone: string }) {
    return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, baseLevel: user.baseLevel, roleId: user.roleId, availability: user.availability, timeZone: user.timeZone };
  }
}

export type RequestMeta = { ip?: string; userAgent?: string };

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
