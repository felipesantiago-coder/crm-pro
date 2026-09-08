/**
 * ensure-admin.mjs — Garante o usuário admin@crm.local (ADMIN) no banco
 * local SEM apagar outros dados (upsert). Uso: node scripts/ensure-admin.mjs
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();
const passwordHash = await bcrypt.hash('crm12345', 10);
const admin = await db.user.upsert({
  where: { email: 'admin@crm.local' },
  update: { passwordHash, role: 'ADMIN' },
  create: { name: 'Admin Demo', email: 'admin@crm.local', passwordHash, role: 'ADMIN' },
});
console.log('Admin OK:', admin.id, admin.email);
await db.$disconnect();
