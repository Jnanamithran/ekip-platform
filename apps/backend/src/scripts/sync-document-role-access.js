require('dotenv').config();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const QDRANT_URL = (process.env.QDRANT_URL || 'http://localhost:6333').replace(/\/$/, '');
const COLLECTIONS = ['ekip_documents', 'ekip_visual_documents'];

async function collectionExists(collection) {
  try {
    await axios.get(`${QDRANT_URL}/collections/${collection}`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) return false;
    throw err;
  }
}

async function syncCollection(collection, documents) {
  if (!(await collectionExists(collection))) {
    console.log(`${collection}: not present; skipping.`);
    return 0;
  }

  let updated = 0;
  for (const document of documents) {
    const response = await axios.post(
      `${QDRANT_URL}/collections/${collection}/points/payload?wait=true`,
      {
        payload: {
          allowed_role_ids: document.allowed_roles.map((access) => access.role_id),
        },
        filter: {
          must: [
            { key: 'document_id', match: { value: document.id } },
            { key: 'org_id', match: { value: document.department.workspace.org_id } },
          ],
        },
      }
    );
    if (response.data.status !== 'ok') {
      throw new Error(`Qdrant did not confirm the role update for document ${document.id}`);
    }
    updated += 1;
  }
  return updated;
}

async function main() {
  const documents = await prisma.document.findMany({
    select: {
      id: true,
      allowed_roles: { select: { role_id: true } },
      department: {
        select: {
          workspace: { select: { org_id: true } },
        },
      },
    },
  });

  let total = 0;
  for (const collection of COLLECTIONS) {
    total += await syncCollection(collection, documents);
  }
  console.log(`Synchronized role access for ${total} document/collection entries.`);
}

main()
  .catch((err) => {
    console.error('[role-access-sync] migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
