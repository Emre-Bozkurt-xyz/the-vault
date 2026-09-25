# The code runner supervisor (runner/worker.mjs) as a long-running service.
#
# This container holds the host's Docker socket, because its whole job is to
# start sandboxes. That makes it host-root-equivalent, exactly like the host
# process it replaces — which is why it is a separate service and why vault-web
# must never be given the socket (plan §8). It receives one secret, the runner
# token, and none of Vault's database, OAuth or storage credentials.
#
# The sandboxes it starts are siblings on the host daemon, not children of this
# container, so they still run under the host's gVisor runtime.
FROM docker:29-cli

RUN apk add --no-cache nodejs

WORKDIR /app
COPY worker.mjs ./

CMD ["node", "worker.mjs"]
