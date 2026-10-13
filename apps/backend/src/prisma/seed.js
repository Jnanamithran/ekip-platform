// Creates the first Organization > Workspace > Department > Admin user.
// Run once with: node src/prisma/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

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
    console.log('Admin user already exists, nothing to do.');
    return;
  }

  // Store a hash, never the plain password (10 = hashing strength)
  const password_hash = await bcrypt.hash(password, 10);

  // Nested create: builds the whole chain in one go
  const org = await prisma.organization.create({
    data: {
      name: 'Demo Organization',
      workspaces: {
        create: {
          name: 'Demo Workspace',
          departments: {
            create: {
              name: 'Demo Department',
              users: {
                create: { email, password_hash, role: 'Admin' },
              },
            },
          },
        },
      },
    },
  });

  console.log('Seeded organization:', org.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());