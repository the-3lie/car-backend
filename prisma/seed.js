import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const nom = process.env.ADMIN_NOM || 'admin';
const mdp = process.env.ADMIN_MOT_DE_PASSE || 'change-moi';

const hash = await bcrypt.hash(mdp, 10);
await prisma.utilisateur.upsert({
  where: { nom },
  update: { motDePasse: hash, role: 'ADMIN' },
  create: { nom, motDePasse: hash, role: 'ADMIN' },
});
console.log(`Compte admin prêt : ${nom}`);
await prisma.$disconnect();
