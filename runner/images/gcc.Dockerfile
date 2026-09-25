# Slice 3 runner proof: C and C++ compile/run + clang-format.
# One image serves both languages; only the driver (gcc vs g++) differs.
FROM gcc:14

RUN apt-get update \
  && apt-get install -y --no-install-recommends clang-format \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
