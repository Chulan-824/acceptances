FROM node:26.7.0-bookworm-slim@sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32 AS web
WORKDIR /src
RUN npm install --global pnpm@12.4.2 --ignore-scripts
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY apps/web apps/web
COPY packages/api-client packages/api-client
RUN pnpm --filter @acceptances/web build

FROM golang:1.26.8-bookworm@sha256:dc9ad6c05acc7a88e5b71bde60a5fe3bd4b9f0db209011711b464107438a8107 AS go-build
WORKDIR /src
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
RUN go build -trimpath -o /out/server ./cmd/server && go build -trimpath -o /out/acceptances ./cmd/acceptances

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587
RUN mkdir -p /app/web /var/lib/acceptances && chown -R 10001:10001 /app /var/lib/acceptances
COPY --from=go-build /out/server /usr/local/bin/server
COPY --from=go-build /out/acceptances /usr/local/bin/acceptances
COPY --from=go-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=go-build /usr/share/doc/ca-certificates/copyright /app/licensing/ca-certificates/copyright
COPY --from=web /src/apps/web/dist /app/web
COPY LICENSE LICENSE-SCOPE.md NOTICE /app/licensing/
COPY LICENSES /app/licensing/LICENSES
COPY docs/licensing /app/licensing/docs/licensing
USER 10001:10001
WORKDIR /app
EXPOSE 8765
ENTRYPOINT ["server"]
CMD ["--listen", ":8765", "--web-dir", "/app/web"]
