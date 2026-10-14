import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { prisma } from '../db.js';
import { exiger } from '../auth.js';
import { norm } from '../verifier.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const r = Router();

// "Numéro de carte" -> "numero_de_carte"
const cle = (s) =>
  String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ALIAS = {
  matricule: ['matricule', 'identifiant', 'id'],
  nom: ['nom'],
  prenom: ['prenom', 'prenoms'],
  filiere: ['filiere', 'classe'],
  car: ['car', 'numero_car', 'n_car', 'num_car', 'numero_de_car', 'bus'],
  carte: ['carte', 'numero_carte', 'n_carte', 'num_carte', 'numero_de_carte'],
  recu: ['recu', 'numero_recu', 'n_recu', 'num_recu', 'numero_de_recu'],
  montant: ['montant'],
  periode: ['periode', 'mois'],
};

function lire(ligne) {
  const k = {};
  for (const [c, v] of Object.entries(ligne)) k[cle(c)] = v;
  const pick = (champ) => {
    for (const a of ALIAS[champ]) if (k[a] !== undefined && String(k[a]).trim() !== '') return String(k[a]).trim();
    return '';
  };
  const montant = pick('montant');
  return {
    matricule: norm(pick('matricule')),
    nom: pick('nom'),
    prenom: pick('prenom'),
    filiere: pick('filiere') || null,
    car: pick('car') || null,
    carte: norm(pick('carte')),
    recu: norm(pick('recu')),
    montant: montant ? parseInt(montant.replace(/\D/g, ''), 10) || null : null,
    periode: pick('periode') || null,
  };
}

const morceaux = (tab, n = 2000) => {
  const out = [];
  for (let i = 0; i < tab.length; i += n) out.push(tab.slice(i, i + n));
  return out;
};

r.post('/', exiger(['ADMIN']), upload.single('fichier'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

  let lignes;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    lignes = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }).map(lire);
  } catch {
    return res.status(400).json({ error: 'Fichier illisible (Excel ou CSV attendu)' });
  }

  const ignorees = [];
  const valides = [];
  lignes.forEach((l, i) => {
    if (!l.matricule) ignorees.push({ ligne: i + 2, raison: 'matricule manquant' });
    else valides.push(l);
  });

  // 1. Étudiants (les existants sont conservés tels quels)
  const parMatricule = new Map();
  for (const l of valides) if (!parMatricule.has(l.matricule)) parMatricule.set(l.matricule, l);
  for (const lot of morceaux([...parMatricule.values()])) {
    await prisma.etudiant.createMany({
      data: lot.map((l) => ({ matricule: l.matricule, nom: l.nom || '-', prenom: l.prenom || '-', filiere: l.filiere, car: l.car })),
      skipDuplicates: true,
    });
  }

  // Numéro de car : mis à jour aussi pour les étudiants déjà présents
  const parCar = new Map();
  for (const l of parMatricule.values()) if (l.car) parCar.set(l.car, [...(parCar.get(l.car) || []), l.matricule]);
  for (const [car, matricules] of parCar) {
    for (const lot of morceaux(matricules, 5000)) {
      await prisma.etudiant.updateMany({ where: { matricule: { in: lot } }, data: { car } });
    }
  }

  const ids = new Map();
  for (const lot of morceaux([...parMatricule.keys()], 5000)) {
    const rows = await prisma.etudiant.findMany({ where: { matricule: { in: lot } }, select: { id: true, matricule: true } });
    rows.forEach((e) => ids.set(e.matricule, e.id));
  }

  // 2. Cartes et reçus
  const cartes = valides.filter((l) => l.carte).map((l) => ({ numero: l.carte, etudiantId: ids.get(l.matricule), matricule: l.matricule }));
  const recus = valides
    .filter((l) => l.recu)
    .map((l) => ({ numeroRecu: l.recu, montant: l.montant, periode: l.periode, etudiantId: ids.get(l.matricule), matricule: l.matricule }));

  for (const lot of morceaux(cartes)) {
    await prisma.carte.createMany({ data: lot.map(({ numero, etudiantId }) => ({ numero, etudiantId })), skipDuplicates: true });
  }
  for (const lot of morceaux(recus)) {
    await prisma.paiement.createMany({
      data: lot.map(({ numeroRecu, montant, periode, etudiantId }) => ({ numeroRecu, montant, periode, etudiantId })),
      skipDuplicates: true,
    });
  }

  // 3. Conflits : un numéro de carte ou de reçu déjà rattaché à un AUTRE étudiant
  const conflits = [];
  for (const lot of morceaux(cartes, 5000)) {
    const rows = await prisma.carte.findMany({ where: { numero: { in: lot.map((c) => c.numero) } }, select: { numero: true, etudiantId: true } });
    const proprio = new Map(rows.map((x) => [x.numero, x.etudiantId]));
    lot.forEach((c) => {
      if (proprio.get(c.numero) !== c.etudiantId) conflits.push({ type: 'carte', numero: c.numero, matricule: c.matricule });
    });
  }
  for (const lot of morceaux(recus, 5000)) {
    const rows = await prisma.paiement.findMany({ where: { numeroRecu: { in: lot.map((c) => c.numeroRecu) } }, select: { numeroRecu: true, etudiantId: true } });
    const proprio = new Map(rows.map((x) => [x.numeroRecu, x.etudiantId]));
    lot.forEach((c) => {
      if (proprio.get(c.numeroRecu) !== c.etudiantId) conflits.push({ type: 'reçu', numero: c.numeroRecu, matricule: c.matricule });
    });
  }

  res.json({ lignesLues: lignes.length, avecCar: [...parCar.values()].reduce((n, m) => n + m.length, 0), etudiants: parMatricule.size, cartes: cartes.length, recus: recus.length, ignorees, conflits });
});

export default r;
