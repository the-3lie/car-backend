import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import importRoutes from './routes/import.js';
import controleRoutes from './routes/controles.js';
import rapportRoutes from './routes/rapports.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant dans .env');
  process.exit(1);
}

const app = express();
const origines = (process.env.FRONTEND_URL || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origines.length === 0 || origines.includes(origin)),
}));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/import', importRoutes);
app.use('/api/controles', controleRoutes);
app.use('/api/rapports', rapportRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur voir le serveur' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API prête sur le port ${port}`));
