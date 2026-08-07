# YourElba Web

App Next.js (App Router), backend incluso: onboarding → richiesta del giorno → risultati.

Il backend (motore di raccomandazione + AI) vive in `server/` ed è esposto tramite le route
`app/api/recommendations/route.ts` e `app/api/health/route.ts` — non è più un servizio separato.

## Requisiti

- Node.js 20+
- Una chiave API Anthropic

## Configurazione

```bash
cp .env.example .env.local
```

Poi apri `.env.local` e incolla la tua chiave Anthropic (variabili `ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL`). Questo file non va mai committato (è già in `.gitignore`); su Vercel le
stesse variabili si impostano in Project Settings → Environment Variables.

## Comandi

```bash
npm install
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

Per rigenerare il dataset normalizzato dopo modifiche a `elba_spiagge_v3.json` o
`data/raw/punteggi_categorie.json`:

```bash
npm run normalize
```

## Route pagina

| Percorso       | Contenuto                                      |
|----------------|------------------------------------------------|
| `/onboarding`  | Profilo: lingua, mobilità, gruppo, cammino, …  |
| `/richiesta`   | Durata, tipo, intensità, testo libero + invio  |
| `/risultati`   | Testo AI (Markdown reso) + card raccomandazioni |

## Route API

| Percorso                 | Metodo | Contenuto                          |
|---------------------------|--------|-------------------------------------|
| `/api/health`             | GET    | Stato del servizio                  |
| `/api/recommendations`    | POST   | Motore di raccomandazione (vedi `server/api/recommendations.ts`) |

Lo stato profilo e risultati è in `localStorage` (resta salvato anche a scheda chiusa, stesso
browser/dispositivo).
