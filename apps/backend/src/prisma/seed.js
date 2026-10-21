// Creates a demo organization with an immutable Owner account.
// Run once with: node src/prisma/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { OWNER_PERMISSIONS } = require('../utils/permissions');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env first');
  }

  // Don't create duplicates if the script is run twice
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log('Seed user already exists, nothing to do.');
    return;
  }

  // Store a hash, never the plain password (10 = hashing strength)
  const password_hash = await bcrypt.hash(password, 10);

  const org = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: 'Demo Organization',
        workspaces: {
          create: {
            name: 'Demo Workspace',
            departments: { create: { name: 'Demo Department' } },
          },
        },
      },
      include: { workspaces: { include: { departments: true } } },
    });
    const role = await tx.organizationRole.create({
      data: {
        org_id: organization.id,
        name: 'Owner',
        permissions: OWNER_PERMISSIONS,
        is_owner: true,
      },
    });
    const owner = await tx.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password_hash,
        role_id: role.id,
        department_id: organization.workspaces[0].departments[0].id,
      },
    });
    await tx.organization.update({
      where: { id: organization.id },
      data: { owner_user_id: owner.id },
    });
    return organization;
  });

  console.log('Seeded organization:', org.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());