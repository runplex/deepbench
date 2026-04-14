# deepbench server
#
# Auto-detects KVM at runtime:
#   - With KVM:    microsandbox (real Linux microVMs) + JustBash
#   - Without KVM: JustBash only (still 70+ commands, Python, etc.)
#
# Works on:
#   - Mac Docker Desktop (no KVM → JustBash only)
#   - Linux with KVM:     docker run --device /dev/kvm -p 3000:3000 deepbench
#   - Linux without KVM:  docker run -p 3000:3000 deepbench
#   - k8s: add securityContext.privileged or KVM device plugin for microsandbox

# Ubuntu 24.04 for glibc >= 2.38 (microsandbox native binding requirement)
FROM ubuntu:24.04

# Install Node.js 22 + system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg libdbus-1-3 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g corepack \
    && corepack enable \
    && corepack prepare pnpm@latest --activate \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for layer caching
COPY package.json pnpm-lock.yaml ./

# pnpm needs shamefully-hoist for microsandbox NAPI-RS native binding resolution
RUN echo "shamefully-hoist=true" > .npmrc

# Install dependencies
# pnpm.onlyBuiltDependencies in package.json whitelists microsandbox + esbuild postinstall
RUN pnpm install

# Copy source
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/

# Build
RUN pnpm build

# Default workspace directory — mount your project here
RUN mkdir -p /workspace
VOLUME /workspace

ENV PORT=3000
EXPOSE 3000

# Auto-detect KVM: uses microsandbox if /dev/kvm exists, JustBash otherwise
CMD ["node", "dist/server/ws-server.js", "--microsandbox", "auto", "--dir", "/workspace", "--python"]
