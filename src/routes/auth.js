import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { signer, exiger } from '../auth.js';

const r = Router();

r.post('/login', async (req, res) => {
  const { nom, motDePasse } = req.body || {};
  const u = await prisma.utilisateur.findUnique({ where: { nom: String(nom || '').trim() } });
  if (!u || !(await bcrypt.compare(String(motDePasse || ''), u.motDePasse))) {
    return res.status(401).json({ error: 'Nom ou mot de passe incorrect' });
  }
  res.json({ token: signer(u), user: { id: u.id, nom: u.nom, role: u.role } });
});

// L'admin crée les comptes contrôleurs
r.post('/utilisateurs', exiger(['ADMIN']), async (req, res) => {
  const { nom, motDePasse, role } = req.body || {};
  if (!nom || !motDePasse || motDePasse.length < 6) {
    return res.status(400).json({ error: 'Nom requis et mot de passe de 6 caractères minimum' });
  }
  try {
    const u = await prisma.utilisateur.create({
      data: { nom: nom.trim(), motDePasse: await bcrypt.hash(motDePasse, 10), role: role === 'ADMIN' ? 'ADMIN' : 'CONTROLEUR' },
    });
    res.status(201).json({ id: u.id, nom: u.nom, role: u.role });
  } catch {
    res.status(409).json({ error: 'Ce nom existe déjà' });
  }
});

r.get('/utilisateurs', exiger(['ADMIN']), async (_req, res) => {
  res.json(await prisma.utilisateur.findMany({ select: { id: true, nom: true, role: true }, orderBy: { nom: 'asc' } }));
});

export default r;
