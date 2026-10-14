import jwt from 'jsonwebtoken';

export const signer = (u) =>
  jwt.sign({ id: u.id, role: u.role, nom: u.nom }, process.env.JWT_SECRET, { expiresIn: '12h' });

// roles vide = tout utilisateur connecté
export const exiger = (roles = []) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Connexion requise' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (roles.length && !roles.includes(p.role)) {
      return res.status(403).json({ error: "Accès réservé à l'administrateur" });
    }
    req.user = p;
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
  }
};
