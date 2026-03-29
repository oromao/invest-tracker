FROM python:3.12-slim

WORKDIR /app

# Install system deps in a single layer
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps before copying source (cache-friendly)
COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy application source
COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--workers", "1"]
