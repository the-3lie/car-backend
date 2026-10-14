import { Router } from 'express';
import * as XLSX from 'xlsx';
import { prisma } from '../db.js';
import { exiger } from '../auth.js';

const r = Router();

const LIBELLES = {
  EN_REGLE: 'En règle',
  RECU_MANQUANT: 'Reçu manquant',
  CARTE_MANQUANTE: 'Carte manquante',
  NON_INSCRIT: 'Non inscrit',
  DOUBLON: 'Doublon / fraude',
};

function filtres(q) {
  const where = {};
  if (q.from || q.to) {
    where.date = {};
    if (q.from) where.date.gte = new Date(`${q.from}T00:00:00`);
    if (q.to) where.date.lte = new Date(`${q.to}T23:59:59.999`);
  }
  if (q.car) where.car = String(q.car);
  if (q.resultat) where.resultat = String(q.resultat);
  else if (q.problemes === '1') where.resultat = { not: 'EN_REGLE' };
  return where;
}

const charger = (q) =>
  prisma.controle.findMany({
    where: filtres(q),
    orderBy: { date: 'desc' },
    take: 5000,
    include: { controleur: { select: { nom: true } } },
  });

r.get('/controles', exiger(['ADMIN']), async (req, res) => {
  const rows = await charger(req.query);
  res.json(
    rows.map((c) => ({
      id: c.id, date: c.date, car: c.car, controleur: c.controleur.nom,
      identifiantSaisi: c.identifiantSaisi, recuSaisi: c.recuSaisi, nomSaisi: c.nomSaisi, resultat: c.resultat,
    })),
  );
});

r.get('/cars', exiger(['ADMIN']), async (_req, res) => {
  const rows = await prisma.controle.findMany({ distinct: ['car'], select: { car: true }, orderBy: { car: 'asc' } });
  res.json(rows.map((x) => x.car));
});

r.get('/export.xlsx', exiger(['ADMIN']), async (req, res) => {
  const rows = await charger(req.query);
  const feuille = XLSX.utils.json_to_sheet(
    rows.map((c) => ({
      Date: c.date.toLocaleString('fr-FR'),
      Car: c.car,
      Contrôleur: c.controleur.nom,
      'Identifiant saisi': c.identifiantSaisi,
      'Reçu saisi': c.recuSaisi || '',
      'Nom saisi': c.nomSaisi || '',
      Résultat: LIBELLES[c.resultat],
    })),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, feuille, 'Contrôles');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="rapport-controles.xlsx"');
  res.send(buf);
});

export default r;
