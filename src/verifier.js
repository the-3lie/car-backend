import { prisma } from './db.js';

export const norm = (s) => String(s ?? '').trim().toUpperCase();

const inclure = { cartes: true, paiements: true };
const infos = (e) => ({ matricule: e.matricule, nom: e.nom, prenom: e.prenom, filiere: e.filiere });

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

export async function verifier({ identifiant, recu }) {
  const id = norm(identifiant);
  const r = norm(recu);
  let etu = await trouver(id);

  // Un reçu saisi en plus : il doit appartenir au même étudiant
  if (r) {
    const p = await prisma.paiement.findUnique({ where: { numeroRecu: r }, include: { etudiant: { include: inclure } } });
    if (p && etu && p.etudiantId !== etu.id) {
      return { resultat: 'DOUBLON', message: 'Ce reçu appartient à un autre étudiant', etudiant: infos(etu) };
    }
    if (p && !etu) etu = p.etudiant;
  }

  if (!etu) return { resultat: 'NON_INSCRIT', message: 'Non inscrit : à signaler', etudiant: null };

  const aCarte = etu.cartes.length > 0;
  const aRecu = etu.paiements.length > 0;
  if (aCarte && aRecu) return { resultat: 'EN_REGLE', message: 'En règle', etudiant: infos(etu) };
  if (aCarte) return { resultat: 'RECU_MANQUANT', message: 'Reçu manquant, à vérifier', etudiant: infos(etu) };
  if (aRecu) return { resultat: 'CARTE_MANQUANTE', message: 'Carte manquante, à vérifier', etudiant: infos(etu) };
  return { resultat: 'RECU_MANQUANT', message: 'Ni carte ni reçu, à vérifier', etudiant: infos(etu) };
}
