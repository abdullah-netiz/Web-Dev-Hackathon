/* eslint-disable no-console */
// Demo workspace for the hackathon (Q13): run with `pnpm seed`. Idempotent: re-running updates the same records.
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { DEFAULT_ROLES } from '../src/auth/permissions';

const prisma = new PrismaClient();
const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@demo.test';
const PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'Demo1234!';

const FIRST = ['Ava', 'Liam', 'Noah', 'Mia', 'Zoe', 'Omar', 'Sara', 'Ali', 'Hina', 'Bilal', 'Emma', 'Lucas', 'Fatima', 'Hamza', 'Nora', 'Ivan', 'Leo', 'Maya', 'Ahmed', 'Sofia'];
const LAST = ['Khan', 'Smith', 'Garcia', 'Ahmed', 'Brown', 'Malik', 'Chen', 'Hussain', 'Rossi', 'Patel', 'Novak', 'Silva', 'Raza', 'Kim', 'Lopez'];
const COMPANIES = ['Sunrise Solar', 'Harbor Realty', 'Northside Clinic', 'Peak Fitness', 'Bluefin Dental', 'Greenleaf Landscaping', 'Metro Movers', 'Crestline Roofing'];

async function main() {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    create: { slug: 'demo', name: 'Demo Services Co', currency: 'USD', timeZone: 'Asia/Karachi', ackWindowSec: 60, levelWindowSec: 60, idleSec: 1800, maxOpenLeadsDefault: 5 },
    update: {},
  });

  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({ where: { workspaceId_name: { workspaceId: workspace.id, name: role.name } }, create: { workspaceId: workspace.id, name: role.name, description: role.description, permissions: role.permissions, isSystem: true }, update: { permissions: role.permissions } });
  }
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { workspaceId: workspace.id } })).map((role) => [role.name, role.id]));

  const users = [
    { email: OWNER_EMAIL, firstName: 'Olivia', lastName: 'Owner', baseLevel: 'OWNER' as const, roleId: null, availability: 'AVAILABLE' as const },
    { email: 'admin@demo.test', firstName: 'Adam', lastName: 'Admin', baseLevel: 'ADMIN' as const, roleId: null, availability: 'AVAILABLE' as const },
    { email: 'manager@demo.test', firstName: 'Maria', lastName: 'Manager', baseLevel: 'USER' as const, roleId: roles.Manager, availability: 'AVAILABLE' as const },
    { email: 'sales1@demo.test', firstName: 'Sam', lastName: 'Sales', baseLevel: 'USER' as const, roleId: roles.Sales, availability: 'AVAILABLE' as const },
    { email: 'sales2@demo.test', firstName: 'Sana', lastName: 'Seller', baseLevel: 'USER' as const, roleId: roles.Sales, availability: 'AVAILABLE' as const },
    { email: 'support@demo.test', firstName: 'Umar', lastName: 'Support', baseLevel: 'USER' as const, roleId: roles.Support, availability: 'BUSY' as const },
  ];
  const userIds: Record<string, string> = {};
  for (const user of users) {
    const saved = await prisma.user.upsert({ where: { email: user.email }, create: { ...user, workspaceId: workspace.id, passwordHash, timeZone: 'Asia/Karachi' }, update: { roleId: user.roleId, availability: user.availability, isActive: true } });
    userIds[user.email] = saved.id;
  }
  // Backup chain for escalation level 2: sales1 → sales2 → manager
  await prisma.user.update({ where: { id: userIds['sales1@demo.test'] }, data: { backupUserId: userIds['sales2@demo.test'] } });
  await prisma.user.update({ where: { id: userIds['sales2@demo.test'] }, data: { backupUserId: userIds['manager@demo.test'] } });

  let pipeline = await prisma.pipeline.findFirst({ where: { workspaceId: workspace.id }, include: { stages: { orderBy: { order: 'asc' } } } });
  if (!pipeline) {
    const created = await prisma.pipeline.create({ data: { workspaceId: workspace.id, name: 'Sales pipeline', isDefault: true } });
    const names: [string, boolean, boolean][] = [['New', false, false], ['Qualified', false, false], ['Proposal', false, false], ['Negotiation', false, false], ['Won', true, false], ['Lost', false, true]];
    await prisma.pipelineStage.createMany({ data: names.map(([name, isWon, isLost], order) => ({ workspaceId: workspace.id, pipelineId: created.id, name, order, isWon, isLost, requiredFieldKeys: name === 'Proposal' ? ['budget'] : name === 'Negotiation' ? ['decision_date'] : [] })) });
    pipeline = await prisma.pipeline.findFirstOrThrow({ where: { id: created.id }, include: { stages: { orderBy: { order: 'asc' } } } });
  }

  // Required fields by stage (F2.4); applied on every run so older seeds get them too
  await prisma.pipelineStage.updateMany({ where: { pipelineId: pipeline.id, name: 'Proposal' }, data: { requiredFieldKeys: ['budget'] } });
  await prisma.pipelineStage.updateMany({ where: { pipelineId: pipeline.id, name: 'Negotiation' }, data: { requiredFieldKeys: ['decision_date'] } });

  const fields = [
    { entity: 'CONTACT' as const, key: 'preferred_channel', label: 'Preferred channel', type: 'DROPDOWN' as const, options: ['WhatsApp', 'Phone', 'Email'] },
    { entity: 'CONTACT' as const, key: 'newsletter', label: 'Newsletter', type: 'CHECKBOX' as const, options: [] },
    { entity: 'OPPORTUNITY' as const, key: 'budget', label: 'Budget', type: 'NUMBER' as const, options: [] },
    { entity: 'OPPORTUNITY' as const, key: 'decision_date', label: 'Decision date', type: 'DATE' as const, options: [] },
    { entity: 'OPPORTUNITY' as const, key: 'property_type', label: 'Property type', type: 'DROPDOWN' as const, options: ['Apartment', 'House', 'Office'] },
  ];
  for (const [order, field] of fields.entries()) {
    await prisma.customFieldDefinition.upsert({ where: { workspaceId_entity_key: { workspaceId: workspace.id, entity: field.entity, key: field.key } }, create: { workspaceId: workspace.id, ...field, order }, update: { options: field.options } });
  }

  const companyIds: string[] = [];
  for (const name of COMPANIES) {
    const existing = await prisma.company.findFirst({ where: { workspaceId: workspace.id, name } });
    const company = existing ?? (await prisma.company.create({ data: { workspaceId: workspace.id, name, domain: `${name.toLowerCase().replace(/\s+/g, '')}.example`, ownerId: userIds['sales1@demo.test'] } }));
    companyIds.push(company.id);
  }

  const existingContacts = await prisma.contact.count({ where: { workspaceId: workspace.id } });
  const owners = [userIds['sales1@demo.test'], userIds['sales2@demo.test'], userIds['support@demo.test']];
  const contactIds: string[] = (await prisma.contact.findMany({ where: { workspaceId: workspace.id }, select: { id: true } })).map((c) => c.id);
  for (let i = existingContacts; i < 320; i += 1) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 7) % LAST.length];
    const contact = await prisma.contact.create({
      data: {
        workspaceId: workspace.id,
        firstName,
        lastName,
        email: `${firstName}.${lastName}.${i}@example.com`.toLowerCase(),
        phone: `+1415555${String(1000 + i).padStart(4, '0')}`,
        companyId: companyIds[i % companyIds.length],
        ownerId: owners[i % owners.length],
        tags: i % 3 === 0 ? ['vip'] : i % 5 === 0 ? ['newsletter'] : [],
        custom: { preferred_channel: ['WhatsApp', 'Phone', 'Email'][i % 3], newsletter: i % 2 === 0 },
        source: 'seed',
        createdAt: new Date(Date.now() - i * 3600_000 * 5),
      },
    });
    contactIds.push(contact.id);
  }

  const existingOpps = await prisma.opportunity.count({ where: { workspaceId: workspace.id } });
  const openStages = pipeline.stages.filter((stage) => !stage.isWon && !stage.isLost);
  for (let i = existingOpps; i < 60; i += 1) {
    const stage = i % 10 === 0 ? pipeline.stages.find((s) => s.isWon)! : i % 11 === 0 ? pipeline.stages.find((s) => s.isLost)! : openStages[i % openStages.length];
    const contactId = contactIds[i * 3 % contactIds.length];
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });
    await prisma.opportunity.create({
      data: {
        workspaceId: workspace.id,
        name: `${COMPANIES[i % COMPANIES.length]} — project ${i + 1}`,
        contactId,
        companyId: contact.companyId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        ownerId: owners[i % owners.length],
        value: 1500 + (i * 737) % 20000,
        currency: 'USD',
        custom: { budget: 2000 + i * 100, property_type: ['Apartment', 'House', 'Office'][i % 3] },
        createdAt: new Date(Date.now() - i * 86_400_000),
      },
    });
  }

  console.log(`Seeded workspace "${workspace.name}" (slug: demo)`);
  console.log(`Users (password for all: ${PASSWORD}):`);
  for (const user of users) console.log(`  ${user.email}  ${user.baseLevel}${user.roleId ? ` / ${Object.entries(roles).find(([, id]) => id === user.roleId)?.[0]}` : ''}`);
  console.log(`Contacts: ${await prisma.contact.count({ where: { workspaceId: workspace.id } })}, opportunities: ${await prisma.opportunity.count({ where: { workspaceId: workspace.id } })}`);
  console.log('Public lead form: GET /f/demo');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
