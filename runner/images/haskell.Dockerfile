# Slice 3 runner proof: Haskell compile/run + Ormolu.
#
# This is by far the largest image in the set (GHC ships its own toolchain and
# package database). Measure it before assuming the mini-PC has room: if it is
# the deciding cost, the alternatives are a `-slim` base or dropping Haskell
# from the first execution release.

# Ormolu ships a static Linux binary in a .zip, and unpacking it happens in a
# throwaway stage rather than in the GHC image. `haskell:9.6` is still on Debian
# bullseye, which is old enough that `apt-get install unzip` now 404s against the
# security pool — and reaching for apt in a pinned toolchain image to obtain one
# binary is the wrong shape regardless of whether the mirror happens to work.
FROM debian:bookworm-slim AS ormolu
ARG ORMOLU_VERSION=0.7.7.0
ADD https://github.com/tweag/ormolu/releases/download/${ORMOLU_VERSION}/ormolu-x86_64-linux.zip /tmp/ormolu.zip
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip ca-certificates \
  && unzip -j /tmp/ormolu.zip ormolu -d /out \
  && chmod 0555 /out/ormolu

FROM haskell:9.6
COPY --from=ormolu /out/ormolu /usr/local/bin/ormolu

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
