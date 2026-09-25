# Slice 3 runner proof: JavaScript execution.
# No formatter here on purpose — Prettier already runs in the browser worker
# (plan §5), so the server side only ever needs to execute.
FROM node:22-slim

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
