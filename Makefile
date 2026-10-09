SHELL := /bin/sh
export GOTOOLCHAIN := go1.26.8
export GOCACHE := $(CURDIR)/.cache/go-build
export GOMODCACHE := $(CURDIR)/.cache/go-mod
SUITE ?=
DOCKER_COMPOSE := docker compose --env-file "$(HOME)/.config/acceptances/compose.env" -p acceptances-v1 -f deploy/compose.yaml

.PHONY: dev generate fmt lint typecheck test build toolchain docker-build docker-up docker-rebuild docker-prepare docker-migrate docker-init-owner sqlc install-skill

toolchain:
	node scripts/v1/toolchain.mjs

dev: toolchain
	node scripts/v1/dev.mjs

sqlc: toolchain
	@test -x .cache/tools/sqlc || GOBIN="$(CURDIR)/.cache/tools" go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
	@test "$$(.cache/tools/sqlc version)" = "v1.31.1"

generate: toolchain sqlc
	node scripts/v1/generate-dto.mjs
	gofmt -w internal/protocol/dto.generated.go
	.cache/tools/sqlc generate
	pnpm exec openapi-typescript contracts/openapi.yaml -o packages/api-client/src/schema.d.ts
	pnpm exec prettier --write packages/api-client/src/schema.d.ts

fmt:
	pnpm exec prettier --write package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client contracts deploy scripts/v1 docs/toolchain.md docs/agents/v1-integration.md docs/v1-implementation-handoff.md README.md db/README.md skills/acceptances-v1
	go fmt ./cmd/... ./internal/... ./contracts/... ./db/...

lint: toolchain
	pnpm exec prettier --check package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client contracts deploy scripts/v1 docs/toolchain.md docs/agents/v1-integration.md docs/v1-implementation-handoff.md README.md db/README.md skills/acceptances-v1
	pnpm exec eslint apps/web packages/api-client scripts/v1 skills/acceptances-v1/scripts eslint.config.js
	go vet ./cmd/... ./internal/... ./contracts/... ./db/...
	@test -z "$$(gofmt -l cmd internal contracts db)" || (echo '请执行 make fmt'; exit 1)

typecheck: toolchain
	pnpm -r typecheck

build: toolchain
	pnpm --filter @acceptances/web build
	mkdir -p build
	go build -trimpath -o build/server ./cmd/server
	go build -trimpath -o build/acceptances ./cmd/acceptances

docker-build:
	$(DOCKER_COMPOSE) build app

docker-prepare:
	$(DOCKER_COMPOSE) run --rm --no-deps --user 0 --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --entrypoint /usr/bin/install app -m 600 -o 10001 -g 10001 /run/secrets/postgres_password /var/lib/acceptances/postgres-password

docker-up: docker-prepare
	$(DOCKER_COMPOSE) up -d

docker-migrate:
	$(DOCKER_COMPOSE) run --rm app migrate up

docker-init-owner:
	$(DOCKER_COMPOSE) run --rm app init-owner

docker-rebuild: docker-build docker-up

test:
	node scripts/v1/test.mjs "$(SUITE)"

install-skill:
	python3 scripts/v1/install-skill.py
