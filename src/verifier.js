import { prisma } from './db.js';

export const norm = (s) => String(s ?? '').trim().toUpperCase();
const sansAccent = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

const inclure = { cartes: true, paiements: true };

// Compare le car de l'étudiant avec celui où se trouve le contrôleur ("Car 3" = "3" = "n° 3")
const cleCar = (s) => {
  const chiffres = String(s ?? '').match(/\d+/g);
  return chiffres ? chiffres.join('-') : String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
};
const memeCar = (a, b) => cleCar(a) !== '' && cleCar(a) === cleCar(b);

function conclure(etu, car) {
  const aCarte = etu.cartes.length > 0;
  const aRecu = etu.paiements.length > 0;
  let base;
  if (aCarte && aRecu) base = { resultat: 'EN_REGLE', message: 'Accepté' };
  else if (aCarte) base = { resultat: 'RECU_MANQUANT', message: 'Reçu manquant, à vérifier' };
  else if (aRecu) base = { resultat: 'CARTE_MANQUANTE', message: 'Carte manquante, à vérifier' };
  else base = { resultat: 'RECU_MANQUANT', message: 'Ni carte ni reçu, à vérifier' };

  if (etu.car && String(car ?? '').trim() && !memeCar(etu.car, car)) {
    return { resultat: 'AUTRE_CAR', message: `Pas dans ce car : son car est le n° ${etu.car}`, etudiant: infos(etu), paiement: base.resultat };
  }
  return { ...base, etudiant: infos(etu), paiement: base.resultat };
}
const infos = (e) => ({ matricule: e.matricule, nom: e.nom, prenom: e.prenom, filiere: e.filiere, car: e.car || null });

// Retrouve un étudiant à partir d'un matricule, d'un numéro de carte ou d'un numéro de reçu
async function trouver(id) {
  if (!id) return null;
  const parMatricule = await prisma.etudiant.findUnique({ where: { matricule: id }, include: inclure });
  if (parMatricule) return parMatricule;
  const carte = await prisma.carte.findUnique({ where: { numero: id }, include: { etudiant: { include: inclure } } });
  if (carte) return carte.etudiant;
  const paiement = await prisma.paiement.findUnique({ where: { numeroRecu: id }, include: { etudiant: { include: inclure } } });
  return paiement ? paiement.etudiant : null;
}

// Recherche par nom ou prénom
async function parNom(texte) {
  const mots = sansAccent(texte).split(/\s+/).filter((m) => m.length >= 2);
  if (!mots.length) return [];
  return prisma.etudiant.findMany({
    where: {
      AND: mots.map((m) => ({
        OR: [{ nom: { contains: m, mode: 'insensitive' } }, { prenom: { contains: m, mode: 'insensitive' } }],
      })),
    },
    include: inclure,
    take: 10,
  });
}

export async function verifier({ identifiant, recu, car }) {
  const id = norm(identifiant);
  const r = norm(recu);
  let etu = await trouver(id);

  if (!etu && id) {
    const trouves = await parNom(identifiant);
    if (trouves.length > 1) {
      return { resultat: 'PLUSIEURS', message: 'Plusieurs étudiants correspondent, choisis le bon', etudiant: null, candidats: trouves.map(infos) };
    }
    if (trouves.length === 1) etu = trouves[0];
  }

  // Un reçu saisi en plus : il doit appartenir au même étudiant
  if (r) {
    const p = await prisma.paiement.findUnique({ where: { numeroRecu: r }, include: { etudiant: { include: inclure } } });
    if (p && etu && p.etudiantId !== etu.id) {
      return { resultat: 'DOUBLON', message: 'Ce reçu appartient à un autre étudiant', etudiant: infos(etu) };
    }
    if (p && !etu) etu = p.etudiant;
  }

  if (!etu) return { resultat: 'NON_INSCRIT', message: "Il n'existe pas dans la liste", etudiant: null };

  return conclure(etu, car);
}
