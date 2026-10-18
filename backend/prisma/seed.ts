import argon2 from 'argon2';
import {
  ALL_PERMISSION_KEYS,
  ADMIN_DEFAULT_PERMISSIONS,
  USER_DEFAULT_PERMISSIONS,
} from '../src/common/permissions';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

async function main(): Promise<void> {
  const slug = process.env.SEED_WORKSPACE_SLUG ?? 'demo';
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.test';
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'Password123!';

  const existing = await prisma.workspace.findUnique({ where: { slug }, select: { id: true } });
  if (existing) {
    console.log(`Workspace "${slug}" already exists — seed skipped (idempotent).`);
    return;
  }

  const passwordHash = await argon2.hash(ownerPassword, ARGON2_OPTIONS);

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Demo Workspace',
      slug,
      settings: { create: {} },
      roles: {
        create: [
          { name: 'Owner', isSystem: true, permissions: ALL_PERMISSION_KEYS },
          { name: 'Admin', isSystem: true, permissions: ADMIN_DEFAULT_PERMISSIONS },
          { name: 'Sales', isSystem: false, permissions: USER_DEFAULT_PERMISSIONS },
        ],
      },
    },
    include: { roles: true },
  });

  const roleByName = new Map(workspace.roles.map((role) => [role.name, role.id]));

  const [owner, admin, sales] = await Promise.all([
    prisma.user.create({
      data: {
        workspaceId: workspace.id,
        email: ownerEmail,
        name: 'Demo Owner',
        passwordHash,
        baseLevel: 'OWNER',
        roleId: roleByName.get('Owner'),
        availability: 'AVAILABLE',
      },
    }),
    prisma.user.create({
      data: {
        workspaceId: workspace.id,
        email: 'admin@demo.test',
        name: 'Ayesha Admin',
        passwordHash,
        baseLevel: 'ADMIN',
        roleId: roleByName.get('Admin'),
        availability: 'AVAILABLE',
      },
    }),
    prisma.user.create({
      data: {
        workspaceId: workspace.id,
        email: 'sales@demo.test',
        name: 'Sana Sales',
        passwordHash,
        baseLevel: 'USER',
        roleId: roleByName.get('Sales'),
        availability: 'AVAILABLE',
      },
    }),
  ]);

  const pipeline = await prisma.pipeline.create({
    data: {
      workspaceId: workspace.id,
      name: 'Sales Pipeline',
      isDefault: true,
      stages: {
        create: [
          { workspaceId: workspace.id, name: 'New', order: 0 },
          { workspaceId: workspace.id, name: 'Qualified', order: 1 },
          { workspaceId: workspace.id, name: 'Proposal', order: 2 },
          { workspaceId: workspace.id, name: 'Won', order: 3, isWon: true },
          { workspaceId: workspace.id, name: 'Lost', order: 4, isLost: true },
        ],
      },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  });

  const stageByName = new Map(pipeline.stages.map((stage) => [stage.name, stage.id]));

  await prisma.customFieldDefinition.createMany({
    data: [
      { workspaceId: workspace.id, entity: 'CONTACT', key: 'job_title', label: 'Job title', type: 'TEXT', order: 0 },
      { workspaceId: workspace.id, entity: 'CONTACT', key: 'linkedin', label: 'LinkedIn URL', type: 'TEXT', order: 1 },
      {
        workspaceId: workspace.id,
        entity: 'OPPORTUNITY',
        key: 'budget_approved',
        label: 'Budget approved',
        type: 'CHECKBOX',
        order: 0,
        pipelineId: pipeline.id,
      },
      {
        workspaceId: workspace.id,
        entity: 'OPPORTUNITY',
        key: 'channel',
        label: 'Channel',
        type: 'SELECT',
        options: ['Inbound', 'Referral', 'Outbound', 'Partner'],
        order: 1,
        pipelineId: pipeline.id,
      },
    ],
  });

  const companySpecs = [
    { name: 'Northwind Traders', domain: 'northwind.test', tags: ['retail'] },
    { name: 'Acme Manufacturing', domain: 'acme.test', tags: ['manufacturing'] },
    { name: 'Globex Logistics', domain: 'globex.test', tags: ['logistics'] },
    { name: 'Initech Software', domain: 'initech.test', tags: ['saas'] },
    { name: 'Umbrella Health', domain: 'umbrella.test', tags: ['healthcare'] },
  ] as const;

  const companies = await Promise.all(
    companySpecs.map((spec) =>
      prisma.company.create({
        data: {
          workspaceId: workspace.id,
          name: spec.name,
          domain: spec.domain,
          phone: `+92000000${companySpecs.indexOf(spec) + 1}`,
          tags: [...spec.tags],
          custom: {},
        },
      }),
    ),
  );

  const owners = [owner.id, admin.id, sales.id];
  const firstNames = ['Ali', 'Bilal', 'Hina', 'Danish', 'Fatima', 'Usman', 'Zara', 'Omar', 'Nida', 'Kashif'];

  const contacts = await Promise.all(
    firstNames.map((firstName, index) =>
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          firstName,
          lastName: `Customer${index + 1}`,
          email: `${firstName.toLowerCase()}${index + 1}@example.test`,
          phone: `+9200001${String(index + 1).padStart(4, '0')}`,
          companyId: companies[index % companies.length].id,
          ownerId: owners[index % owners.length],
          tags: index % 3 === 0 ? ['vip'] : [],
          custom: { job_title: index % 2 === 0 ? 'Operations Manager' : 'Founder' },
        },
      }),
    ),
  );

  const opportunitySpecs = [
    { name: 'Annual renewal', stage: 'Won', value: 12000, status: 'PAID' },
    { name: 'Logistics expansion', stage: 'Proposal', value: 8400, status: 'NONE' },
    { name: 'New workspace rollout', stage: 'Qualified', value: 5200, status: 'NONE' },
    { name: 'Support retainer', stage: 'New', value: 2400, status: 'NONE' },
    { name: 'Hardware refresh', stage: 'Lost', value: 3100, status: 'NONE' },
    { name: 'Health platform pilot', stage: 'Proposal', value: 15000, status: 'PENDING' },
    { name: 'Field team onboarding', stage: 'Qualified', value: 6800, status: 'NONE' },
    { name: 'Warehouse automation', stage: 'New', value: 22000, status: 'NONE' },
    { name: 'Analytics add-on', stage: 'Won', value: 4200, status: 'PAID' },
    { name: 'Compliance package', stage: 'Proposal', value: 9800, status: 'NONE' },
    { name: 'Seasonal campaign', stage: 'Lost', value: 1800, status: 'NONE' },
    { name: 'Enterprise upgrade', stage: 'Qualified', value: 17500, status: 'NONE' },
  ] as const;

  await Promise.all(
    opportunitySpecs.map((spec, index) =>
      prisma.opportunity.create({
        data: {
          workspaceId: workspace.id,
          name: spec.name,
          companyId: companies[index % companies.length].id,
          contactId: contacts[index % contacts.length].id,
          pipelineId: pipeline.id,
          stageId: stageByName.get(spec.stage)!,
          ownerId: owners[index % owners.length],
          value: spec.value,
          paymentStatus: spec.status,
          closeDate: new Date(Date.now() + (index + 1) * 86_400_000),
          custom: { budget_approved: index % 2 === 0, channel: 'Inbound' },
        },
      }),
    ),
  );

  const now = Date.now();
  const assignedLead = await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      name: 'Walk-in enquiry — Sana',
      phone: '+92000020001',
      email: 'lead1@example.test',
      source: 'WEB_FORM',
      status: 'ASSIGNED',
      contactId: contacts[0].id,
      ownerId: sales.id,
      lastActivityAt: new Date(now - 60_000),
      assignments: {
        create: {
          workspaceId: workspace.id,
          userId: sales.id,
          assignedById: admin.id,
          status: 'PENDING',
          level: 1,
          dueAt: new Date(now - 30_000),
          jobId: `esc-seed-1`,
        },
      },
    },
  });

  await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      name: 'WhatsApp enquiry — pricing',
      phone: '+92000020002',
      source: 'WHATSAPP',
      status: 'ACKNOWLEDGED',
      contactId: contacts[1].id,
      ownerId: admin.id,
      escalationCount: 1,
      timeToFirstResponseSec: 47,
      lastActivityAt: new Date(now - 10 * 60_000),
      assignments: {
        create: {
          workspaceId: workspace.id,
          userId: admin.id,
          status: 'ACKNOWLEDGED',
          level: 1,
          dueAt: new Date(now - 9 * 60_000),
          acknowledgedAt: new Date(now - 8 * 60_000),
          jobId: `esc-seed-2`,
        },
      },
    },
  });

  await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      name: 'Recovered — idle follow-up',
      phone: '+92000020003',
      source: 'MANUAL',
      status: 'ASSIGNED',
      contactId: contacts[2].id,
      ownerId: owner.id,
      escalationCount: 2,
      recoveryReason: 'ESCALATED_TWICE',
      lastActivityAt: new Date(now - 3 * 86_400_000),
      assignments: {
        create: [
          {
            workspaceId: workspace.id,
            userId: sales.id,
            status: 'EXPIRED',
            level: 1,
            dueAt: new Date(now - 3 * 86_400_000),
            expiredAt: new Date(now - 3 * 86_400_000),
          },
          {
            workspaceId: workspace.id,
            userId: owner.id,
            assignedById: admin.id,
            status: 'PENDING',
            level: 2,
            dueAt: new Date(now - 86_400_000),
            jobId: `esc-seed-3`,
          },
        ],
      },
    },
  });

  await prisma.lead.create({
    data: {
      workspaceId: workspace.id,
      name: 'Unassigned web form',
      email: 'lead4@example.test',
      source: 'WEB_FORM',
      status: 'NEW',
      message: 'Please call me back about pricing.',
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        workspaceId: workspace.id,
        actorId: owner.id,
        actorLabel: 'Demo Owner',
        action: 'workspace.seeded',
        entityType: 'workspace',
        entityId: workspace.id,
        summary: 'Seeded the demo workspace with sample CRM data.',
      },
      {
        workspaceId: workspace.id,
        actorId: admin.id,
        actorLabel: 'Ayesha Admin',
        action: 'lead.assigned',
        entityType: 'lead',
        entityId: assignedLead.id,
        summary: 'Assigned lead to Sana Sales (level 1).',
      },
    ],
  });

  console.log(`Seeded workspace "${slug}" — sign in as ${ownerEmail} / ${ownerPassword}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
