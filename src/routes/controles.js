import { Router } from 'express';
import { randomUUID } from 'crypto';
import { prisma } from '../db.js';
import { exiger } from '../auth.js';
import { verifier } from '../verifier.js';

const r = Router();
const TOUS = ['ADMIN', 'CONTROLEUR'];
const RESULTATS = ['EN_REGLE', 'RECU_MANQUANT', 'CARTE_MANQUANTE', 'NON_INSCRIT', 'DOUBLON'];

// Liste complète à télécharger avant le trajet (mode hors-ligne)
r.get('/snapshot', exiger(TOUS), async (_req, res) => {
  const rows = await prisma.etudiant.findMany({
    select: {
      matricule: true, nom: true, prenom: true, filiere: true,
      cartes: { select: { numero: true } },
      paiements: { select: { numeroRecu: true } },
    },
  });
  res.json({
    date: new Date().toISOString(),
    etudiants: rows.map((e) => ({
      matricule: e.matricule, nom: e.nom, prenom: e.prenom, filiere: e.filiere,
      cartes: e.cartes.map((c) => c.numero),
      recus: e.paiements.map((p) => p.numeroRecu),
    })),
  });
});

// Contrôle en ligne (utilisé seulement si la liste n'est pas encore téléchargée)
r.post('/verifier', exiger(TOUS), async (req, res) => {
  const { identifiant, recu, nomSaisi, car } = req.body || {};
  if (!identifiant && !recu) return res.status(400).json({ error: 'Saisis un identifiant, une carte ou un reçu' });
  const rep = await verifier({ identifiant, recu });
  await prisma.controle.create({
    data: {
      uuid: randomUUID(),
      car: String(car || 'Non précisé'),
      controleurId: req.user.id,
      identifiantSaisi: String(identifiant || recu),
      recuSaisi: recu ? String(recu) : null,
      nomSaisi: nomSaisi ? String(nomSaisi) : null,
      resultat: rep.resultat,
    },
  });
  res.json(rep);
});

// Envoi des contrôles faits hors-ligne. Relancer la synchro ne crée pas de doublons (uuid unique).
r.post('/sync', exiger(TOUS), async (req, res) => {
  const liste = Array.isArray(req.body?.controles) ? req.body.controles : [];
  const data = liste
    .filter((c) => c && c.uuid && RESULTATS.includes(c.resultat))
    .map((c) => ({
      uuid: String(c.uuid),
      date: c.date ? new Date(c.date) : new Date(),
      car: String(c.car || 'Non précisé'),
      controleurId: req.user.id,
      identifiantSaisi: String(c.identifiantSaisi || ''),
      recuSaisi: c.recuSaisi ? String(c.recuSaisi) : null,
      nomSaisi: c.nomSaisi ? String(c.nomSaisi) : null,
      resultat: c.resultat,
    }));
  const out = await prisma.controle.createMany({ data, skipDuplicates: true });
  res.json({ recus: liste.length, enregistres: out.count });
});

export default r;
