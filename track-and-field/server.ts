import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY manquante dans la configuration serveur.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface AnalyzeRouteBody {
  lang?: 'fr' | 'en';
  title: string;
  stats: {
    distanceKm: number;
    durationSec: number;
    avgSpeedKmh: number;
    maxSpeedKmh: number;
    elevationGainM: number;
    elevationLossM: number;
    paceMinPerKm: string;
    bestPaceMinPerKm?: string;
    waypointCount: number;
  };
  waypoints: Array<{
    type: string;
    title: string;
    distanceKm: number;
    altitude: number;
  }>;
  photoDataUrls?: string[];
  availableTracks: Array<{ id: string; title: string; genre: string; mood: string; bpm: number }>;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.post('/api/ai/analyze-route', async (req, res) => {
    try {
      const body = req.body as AnalyzeRouteBody;
      if (!body || !body.stats) {
        res.status(400).json({ error: 'Missing route stats.' });
        return;
      }

      const lang = body.lang === 'en' ? 'en' : 'fr';
      const ai = getGeminiClient();
      const mins = Math.round(body.stats.durationSec / 60);
      const waypointLines = (body.waypoints || [])
        .map(
          (w, i) =>
            `${i + 1}. [${w.type}] "${w.title}" @ ${w.distanceKm.toFixed(2)} km (${Math.round(w.altitude)} m)`
        )
        .join('\n');

      const tracksList = (body.availableTracks || [])
        .map((t) => `- ${t.id}: "${t.title}" (${t.genre}, ${t.mood}, ${t.bpm} BPM)`)
        .join('\n');

      const promptText =
        lang === 'en'
          ? `Analyze this GPS route recorded in the Track & Field app and generate a motivating, concise summary in natural English.

Current title: ${body.title || 'Route'}
Stats:
- Distance: ${body.stats.distanceKm.toFixed(2)} km
- Duration: ${mins} min (${body.stats.durationSec} s)
- Avg Speed: ${body.stats.avgSpeedKmh.toFixed(1)} km/h (max ${body.stats.maxSpeedKmh.toFixed(1)} km/h)
- Avg Pace: ${body.stats.paceMinPerKm} /km
- Best Pace: ${body.stats.bestPaceMinPerKm || 'N/A'} /km
- Elevation Gain: +${body.stats.elevationGainM} m / Loss: -${body.stats.elevationLossM} m
- Captured Waypoints (${body.stats.waypointCount}):
${waypointLines || 'None captured'}

Available instrumental tracks:
${tracksList}

Respond ONLY in valid JSON matching the requested schema, with all text values in English.`
          : `Analyse cette sortie GPS enregistrée dans l'application Track & Field et génère un résumé complet en français naturel, motivant et concis.

Titre actuel: ${body.title || 'Parcours'}
Statistiques:
- Distance: ${body.stats.distanceKm.toFixed(2)} km
- Durée: ${mins} min (${body.stats.durationSec} s)
- Vitesse moyenne: ${body.stats.avgSpeedKmh.toFixed(1)} km/h (max ${body.stats.maxSpeedKmh.toFixed(1)} km/h)
- Allure moyenne: ${body.stats.paceMinPerKm} /km
- Meilleure allure: ${body.stats.bestPaceMinPerKm || 'N/D'} /km
- Dénivelé positif: +${body.stats.elevationGainM} m / négatif: -${body.stats.elevationLossM} m
- Points de repère capturés (${body.stats.waypointCount}):
${waypointLines || 'Aucun repère capturé'}

Pistes musicales instrumentales disponibles:
${tracksList}

Réponds uniquement en JSON valide selon le schéma demandé, entièrement en français.`;

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

      // Include up to 2 JPEG/PNG photos if captured by user
      if (Array.isArray(body.photoDataUrls)) {
        for (const dataUrl of body.photoDataUrls.slice(0, 2)) {
          const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          }
        }
      }
      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            lang === 'en'
              ? 'You are an outdoor sports coach and storyteller for Track & Field. Reply in clear, authentic, energetic English without technical jargon.'
              : 'Tu es un coach sportif et créateur de récits outdoor pour Track & Field. Réponds en français clair, authentique et énergique, sans jargon technique.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              suggestedTitle: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Short evocative 3-to-6 word title for the route video.'
                    : 'Titre court et évocateur de 3 à 6 mots pour la vidéo du parcours.',
              },
              storySummary: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Immersive 2-to-3 sentence story of the outing.'
                    : 'Récit immersif de la sortie en 2 à 3 phrases.',
              },
              socialCaption: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Ready-to-post caption for Instagram, TikTok, or WhatsApp with stats and 3-4 hashtags.'
                    : 'Légende prête à partager sur Instagram, TikTok ou WhatsApp avec les stats et 3 à 4 hashtags.',
              },
              coachInsight: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Sports coaching insight on effort, pace, elevation, and recovery in 2 sentences.'
                    : 'Conseil sportif et analyse de l’effort (allure, dénivelé, récupération) en 2 phrases.',
              },
              recommendedTrackId: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Exact id of the best-fitting instrumental track from the provided list.'
                    : 'Identifiant exact (id) de la piste musicale la plus adaptée dans la liste fournie.',
              },
              recommendedTrackReason: {
                type: Type.STRING,
                description:
                  lang === 'en'
                    ? 'Short 1-sentence reason for the music choice.'
                    : 'Courte explication (1 phrase) du choix musical.',
              },
            },
            required: [
              'suggestedTitle',
              'storySummary',
              'socialCaption',
              'coachInsight',
              'recommendedTrackId',
              'recommendedTrackReason',
            ],
          },
        },
      });

      const raw = (response.text ?? '{}').trim();
      const parsed = JSON.parse(raw);
      res.json(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur IA inconnue';
      console.error('[AI analyze-route error]', err);
      res.status(500).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Track & Field server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
