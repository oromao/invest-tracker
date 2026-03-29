# AlphaTrade / Alpha Factory

Lightweight crypto strategy platform with:

- real market ingestion
- feature generation
- regime detection
- signal generation
- risk checks
- backtesting and validation
- staged strategy promotion
- optional AI advisory

## Local run

Copy `.env.example` to `.env` and adjust only what you need.

### Minimal mode

Starts the lightweight core stack:

```bash
docker compose up -d --build
```

Includes:

- PostgreSQL
- Redis
- backend API

### Research mode

Adds optional research/context services:

```bash
docker compose --profile rag up -d
```

### AI-assisted mode

Adds local LLM support with Ollama:

```bash
AI_ENABLED=true AI_PROVIDER=ollama docker compose --profile ai up -d
```

### Full local stack

```bash
docker compose --profile rag --profile ai --profile ui --profile monitoring up -d
```

## Endpoints

- Backend API: `http://localhost:8000`
- Health: `http://localhost:8000/health`
- Frontend UI: `http://localhost:3002`
- Grafana: `http://localhost:3001`
- Prometheus: `http://localhost:9090`
- Qdrant: `http://localhost:6333`

## Notes

- AI is optional and disabled by default.
- Heavy services are isolated behind compose profiles.
- The system is designed to run safely without AI.
