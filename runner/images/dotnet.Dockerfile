# Slice 3 runner proof: C# compile/run + CSharpier.
#
# C# is the one language that cannot just compile a loose file: the SDK wants a
# project. Plan §3 calls for a *host-owned* console project, so it is scaffolded
# and restored here at build time. A job then only drops its own source into the
# workspace — it never runs `dotnet new` or `dotnet restore` against the network,
# which a sandbox does not have.
FROM mcr.microsoft.com/dotnet/sdk:8.0

# NUGET_PACKAGES must point somewhere world-readable. The default is $HOME/.nuget,
# which would be /root/.nuget here — the unprivileged job user could not read it,
# and the offline restore below would fail at runtime for no obvious reason.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    DOTNET_NOLOGO=1 \
    NUGET_PACKAGES=/opt/nuget \
    PATH="${PATH}:/opt/dotnet-tools"

RUN dotnet tool install csharpier --version 0.30.6 --tool-path /opt/dotnet-tools

# Scaffold and build once so the package cache and the SDK's first-run state are
# warm. A job copies this project into its workspace and swaps in its own file.
RUN mkdir -p /opt/project \
  && cd /opt/project \
  && dotnet new console --name app --output . \
  && dotnet build -c Release \
  && chmod -R a+rX /opt/project /opt/nuget /opt/dotnet-tools

RUN useradd --create-home --uid 10001 runner
USER runner

# The SDK writes to $HOME even for a plain build; /tmp is the job's tmpfs.
ENV HOME=/tmp
WORKDIR /w
