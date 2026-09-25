# Slice 3 runner proof: Python execution + Ruff formatting.
# Pinned by tag; slice 4 must pin by digest before anything runs untrusted code.
FROM python:3.12-slim

# Ruff is a single static binary, so this stays small. Installed at build time
# because a job container never has network access.
RUN pip install --no-cache-dir ruff==0.14.0

# Every job runs as this user with no write access outside its mounted workspace.
RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
