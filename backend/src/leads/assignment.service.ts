import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { LeadsRepository, type CandidateUser } from './leads.repository';

/** Chooses who receives a lead: round-robin over Available users under the open-lead cap (F3.3). */
@Injectable()
export class AssignmentService {
  constructor(private readonly repository: LeadsRepository) {}

  async pickNext(
    workspaceId: string,
    options: { excludeUserIds?: string[]; managerOnly?: boolean },
    tx?: Prisma.TransactionClient,
  ): Promise<CandidateUser | null> {
    const settings = await this.repository.ensureSettings(workspaceId, tx);
    const candidates = (await this.repository.candidateUsers(
      workspaceId,
      { managerOnly: options.managerOnly ?? false },
      tx,
    )).filter((candidate) => !(options.excludeUserIds ?? []).includes(candidate.id));
    if (candidates.length === 0) {
      return null;
    }

    const counts = await this.repository.openLeadCounts(
      workspaceId,
      candidates.map((candidate) => candidate.id),
      tx,
    );
    const eligible = candidates.filter(
      (candidate) => (counts.get(candidate.id) ?? 0) < settings.maxOpenLeads,
    );
    if (eligible.length === 0) {
      return null;
    }

    const cursor = await this.repository.advanceRoundRobinCursor(workspaceId, tx);
    return eligible[(cursor - 1) % eligible.length];
  }
}
