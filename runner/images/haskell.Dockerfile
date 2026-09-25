# Slice 3 runner proof: Haskell compile/run + Ormolu.
#
# This is by far the largest image in the set (GHC ships its own toolchain and
# package database). Measure it before assuming the mini-PC has room: if it is
# the deciding cost, the alternatives are a `-slim` base or dropping Haskell
# from the first execution release.
FROM haskell:9.6

# Ormolu publishes a static Linux binary. Building it from Hackage instead would
# take many minutes and drag a full cabal build tree into the image.
ARG ORMOLU_VERSION=0.7.7.0
ADD https://github.com/tweag/ormolu/releases/download/${ORMOLU_VERSION}/ormolu-x86_64-linux.zip /tmp/ormolu.zip
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && unzip -j /tmp/ormolu.zip ormolu -d /usr/local/bin \
  && chmod 0555 /usr/local/bin/ormolu \
  && rm -rf /tmp/ormolu.zip /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 runner
USER runner
WORKDIR /w
