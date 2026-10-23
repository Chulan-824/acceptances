SHELL := /bin/sh
export GOTOOLCHAIN := go1.26.8
export GOCACHE := $(CURDIR)/.cache/go-build
export GOMODCACHE := $(CURDIR)/.cache/go-mod
SUITE ?= all
DOCKER_COMPOSE := docker compose -p acceptances -f deploy/compose.yaml
MYSQL_DSN_FILE := $(CURDIR)/.cache/mysql/dev.dsn
FORMAT_PATHS := package.json pnpm-workspace.yaml toolchain.lock.json eslint.config.js apps/web packages/api-client deploy scripts/v1 docs/toolchain.md docs/agents/v1-integration.md docs/v1-implementation-handoff.md README.md db/README.md docs/mysql-storage.md docs/adr/0010-mysql-archive.md docs/licensing/runtime-materials.json skills/acceptances-v1

.PHONY: dev dev-up dev-status dev-stop services-status services-stop fmt lint typecheck test build toolchain docker-build docker-up docker-migrate docker-rebuild mysql-up mysql-migrate mysql-status mysql-stop install-skill replace-skill

toolchain:
	node scripts/v1/toolchain.mjs

dev: toolchain mysql-up
	ACCEPTANCES_DB_DRIVER=mysql ACCEPTANCES_MYSQL_DSN_FILE="$(MYSQL_DSN_FILE)" node scripts/v1/dev.mjs

dev-up: toolchain mysql-up
	ACCEPTANCES_DB_DRIVER=mysql ACCEPTANCES_MYSQL_DSN_FILE="$(MYSQL_DSN_FILE)" node scripts/v1/dev.mjs up

mysql-up:
	node scripts/v1/mysql.mjs up

mysql-migrate: toolchain mysql-up
	node scripts/v1/mysql.mjs migrate

mysql-status:
	node scripts/v1/mysql.mjs status

mysql-stop:
	node scripts/v1/mysql.mjs stop

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
	go fmt ./cmd/... ./internal/... ./db/...

lint: toolchain
	pnpm exec prettier --check $(FORMAT_PATHS)
	pnpm exec eslint apps/web packages/api-client scripts/v1 eslint.config.js
	go vet ./cmd/... ./internal/... ./db/...
	@test -z "$$(gofmt -l cmd internal db)" || (echo '请执行 make fmt'; exit 1)

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
	node scripts/v1/mysql.mjs prepare
	$(DOCKER_COMPOSE) up --build -d

docker-rebuild: docker-up

docker-migrate: docker-build
	node scripts/v1/mysql.mjs prepare
	$(DOCKER_COMPOSE) up -d --wait mysql
	$(DOCKER_COMPOSE) run --rm --no-deps app --database=mysql --migrate-sqlite --data-dir=/var/lib/acceptances

test:
	node scripts/v1/test.mjs "$(SUITE)"

install-skill:
	python3 scripts/v1/install-skill.py

replace-skill:
	python3 scripts/v1/install-skill.py --replace

# Optional real-Chrome/Jev toolchain; never starts the Playwright suite.
JEV_PYTHON := $(CURDIR)/tools/jev-browser/.venv/bin/python
JEV_RUFF := $(CURDIR)/tools/jev-browser/.venv/bin/ruff
FORMAT_PATHS += docs/agents/jev-browser.md tools/jev-browser/task.example.json
JEV_LAUNCH := python3 tools/jev-browser/launch.py
.PHONY: jev-setup jev-config jev-doctor jev-inspect jev-run jev-check jev-docker-build jev-docker-doctor jev-docker-inspect jev-docker-run

jev-setup:
	UV_CACHE_DIR="$(CURDIR)/.cache/uv" UV_PYTHON_INSTALL_DIR="$(CURDIR)/.cache/uv-python" uv sync --project tools/jev-browser --locked --python 3.12

jev-doctor:
	$(JEV_LAUNCH) doctor

jev-config:
	$(JEV_LAUNCH) config

jev-inspect:
	@test -n "$(URL)" || (echo '用法: make jev-inspect URL=http://127.0.0.1:5173'; exit 1)
	$(JEV_LAUNCH) inspect "$(URL)"

jev-run:
	@test -n "$(TASK)" || (echo '用法: make jev-run TASK=/绝对路径/task.json'; exit 1)
	$(JEV_LAUNCH) run "$(TASK)"

jev-docker-build:
	$(JEV_LAUNCH) docker build

jev-docker-doctor:
	$(JEV_LAUNCH) docker doctor

jev-docker-inspect:
	@test -n "$(URL)" || (echo '用法: make jev-docker-inspect URL=http://127.0.0.1:5173'; exit 1)
	$(JEV_LAUNCH) docker inspect "$(URL)"

jev-docker-run:
	@test -n "$(TASK)" || (echo '用法: make jev-docker-run TASK=/绝对路径/task.json'; exit 1)
	$(JEV_LAUNCH) docker run "$(TASK)"

jev-check:
	"$(JEV_RUFF)" format --check tools/jev-browser
	"$(JEV_RUFF)" check tools/jev-browser
	"$(JEV_PYTHON)" -m unittest discover -s tools/jev-browser -p 'test_*.py' -v
