SHELL := /bin/sh
export GOTOOLCHAIN := go1.26.8
export GOCACHE := $(CURDIR)/.cache/go-build
export GOMODCACHE := $(CURDIR)/.cache/go-mod
SUITE ?=

.PHONY: dev generate fmt lint typecheck test build toolchain

toolchain:
	node scripts/v1/toolchain.mjs

dev: toolchain
	node scripts/v1/dev.mjs

generate: toolchain
	pnpm exec openapi-typescript contracts/openapi.yaml -o packages/api-client/src/schema.d.ts
	pnpm exec prettier --write packages/api-client/src/schema.d.ts

fmt:
	pnpm exec prettier --write package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client contracts deploy scripts/v1 docs/toolchain.md README.md db/README.md
	go fmt ./cmd/... ./internal/...

lint: toolchain
	pnpm exec prettier --check package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client contracts deploy scripts/v1 docs/toolchain.md README.md db/README.md
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

test:
	node scripts/v1/test.mjs "$(SUITE)"
