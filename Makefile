SHELL := /bin/sh
export GOTOOLCHAIN := go1.26.8
export GOCACHE := $(CURDIR)/.cache/go-build
export GOMODCACHE := $(CURDIR)/.cache/go-mod
SUITE ?= all
DOCKER_COMPOSE := docker compose -p acceptances -f deploy/compose.yaml
FORMAT_PATHS := package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client deploy scripts/v1 docs/toolchain.md docs/agents/v1-integration.md docs/v1-implementation-handoff.md README.md skills/acceptances-v1

.PHONY: dev dev-up dev-status dev-stop services-status services-stop fmt lint typecheck test build toolchain docker-build docker-up docker-rebuild install-skill replace-skill

toolchain:
	node scripts/v1/toolchain.mjs

dev: toolchain
	node scripts/v1/dev.mjs

dev-up: toolchain
	node scripts/v1/dev.mjs up

dev-status:
	node scripts/v1/dev.mjs status

dev-stop:
	node scripts/v1/dev.mjs stop

services-status:
	node scripts/v1/services.mjs status

services-stop:
	node scripts/v1/services.mjs stop

fmt:
	pnpm exec prettier --write $(FORMAT_PATHS)
	go fmt ./cmd/... ./internal/...

lint: toolchain
	pnpm exec prettier --check $(FORMAT_PATHS)
	pnpm exec eslint apps/web packages/api-client scripts/v1 eslint.config.js
	go vet ./cmd/... ./internal/...
	@test -z "$$(gofmt -l cmd internal)" || (echo '请执行 make fmt'; exit 1)

typecheck: toolchain
	pnpm -r typecheck

build: toolchain
	pnpm --filter @acceptances/web build
	mkdir -p build
	go build -trimpath -o build/server ./cmd/server
	go build -trimpath -o build/acceptances ./cmd/acceptances

docker-build:
	$(DOCKER_COMPOSE) build app

docker-up:
	$(DOCKER_COMPOSE) up --build -d

docker-rebuild: docker-up

test:
	node scripts/v1/test.mjs "$(SUITE)"

install-skill:
	python3 scripts/v1/install-skill.py

replace-skill:
	python3 scripts/v1/install-skill.py --replace
