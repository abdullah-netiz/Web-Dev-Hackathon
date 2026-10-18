import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class MetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  countLeadsCreatedSince(workspaceId: string, since: Date, ownerId?: string): Promise<number> {
    return this.prisma.lead.count({
      where: { workspaceId, createdAt: { gte: since }, ...(ownerId ? { ownerId } : {}) },
    });
  }

  async averageFirstResponseSeconds(
    workspaceId: string,
    since: Date,
    ownerId?: string,
  ): Promise<number | null> {
    const result = await this.prisma.lead.aggregate({
      where: {
        workspaceId,
        timeToFirstResponseSec: { not: null },
        createdAt: { gte: since },
        ...(ownerId ? { ownerId } : {}),
      },
      _avg: { timeToFirstResponseSec: true },
    });
    return result._avg.timeToFirstResponseSec ?? null;
  }

  countRecovery(
    workspaceId: string,
    bounds: { now: Date; idleBefore: Date },
    ownerId?: string,
  ): Promise<number> {
    return this.prisma.lead.count({
      where: {
        workspaceId,
        status: { not: 'CLOSED' },
        ...(ownerId ? { ownerId } : {}),
        OR: [
          { assignments: { some: { status: 'PENDING', dueAt: { lte: bounds.now } } } },
          { escalationCount: { gte: 2 } },
          { lastActivityAt: { lt: bounds.idleBefore } },
        ],
      },
    });
  }

  countEscalationsSince(workspaceId: string, since: Date, userId?: string): Promise<number> {
    return this.prisma.leadAssignment.count({
      where: {
        workspaceId,
        level: { gt: 1 },
        createdAt: { gte: since },
        ...(userId ? { userId } : {}),
      },
    });
  }

  async availabilityBreakdown(workspaceId: string): Promise<Array<{ status: string; count: number }>> {
    const rows = await this.prisma.user.groupBy({
      by: ['availability'],
      where: { workspaceId, isActive: true },
      _count: { _all: true },
    });
    return rows.map((row) => ({ status: row.availability, count: row._count._all }));
  }

  async openPipelineByStage(
    workspaceId: string,
  ): Promise<Array<{ stageId: string; stage: string; count: number; value: number }>> {
    const grouped = await this.prisma.opportunity.groupBy({
      by: ['stageId'],
      where: { workspaceId, stage: { isWon: false, isLost: false } },
      _sum: { value: true },
      _count: { _all: true },
    });
    const stageIds = grouped.map((row) => row.stageId).filter((id): id is string => id !== null);
    const stages = await this.prisma.pipelineStage.findMany({
      where: { id: { in: stageIds }, workspaceId },
      select: { id: true, name: true, order: true },
    });
    const byId = new Map(stages.map((stage) => [stage.id, stage]));
    return grouped
      .filter((row) => row.stageId !== null)
      .map((row) => ({
        stageId: row.stageId as string,
        stage: byId.get(row.stageId as string)?.name ?? 'Unknown stage',
        count: row._count._all,
        value: Number(row._sum.value ?? 0),
      }))
      .sort(
        (a, b) =>
          (byId.get(a.stageId)?.order ?? 0) - (byId.get(b.stageId)?.order ?? 0),
      );
  }

  async upcomingAppointments(workspaceId: string, from: Date, hostUserId?: string) {
    const where = {
      workspaceId,
      status: 'SCHEDULED' as const,
      startAt: { gte: from },
      ...(hostUserId ? { hostUserId } : {}),
    };
    const [count, next] = await Promise.all([
      this.prisma.appointment.count({ where }),
      this.prisma.appointment.findMany({
        where,
        orderBy: { startAt: 'asc' },
        take: 5,
        select: { id: true, title: true, startAt: true, host: { select: { id: true, name: true } } },
      }),
    ]);
    return { count, next };
  }

  async paymentsThisMonth(workspaceId: string, monthStart: Date) {
    const [paid, refunded] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { workspaceId, status: 'PAID', paidAt: { gte: monthStart } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { workspaceId, status: 'REFUNDED', refundedAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
    ]);
    const received = Number(paid._sum.amount ?? 0);
    const refunds = Number(refunded._sum.amount ?? 0);
    return { net: received - refunds, received, refunds, count: paid._count._all };
  }

  getSettings(workspaceId: string) {
    return this.prisma.workspaceSettings.findUnique({ where: { workspaceId } });
  }

  getPrefs(workspaceId: string, userId: string) {
    return this.prisma.dashboardPrefs.findUnique({ where: { userId } });
  }

  async savePrefs(workspaceId: string, userId: string, widgets: string[]) {
    return this.prisma.dashboardPrefs.upsert({
      where: { userId },
      create: { workspaceId, userId, widgets },
      update: { widgets },
      select: { widgets: true, updatedAt: true },
    });
  }
}
