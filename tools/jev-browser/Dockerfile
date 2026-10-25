FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2 AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.12.3@sha256:2d890623d310b57771ce840f0da5eed5fc6d657da05ffaa45d82797b53fa3abc /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/jev
COPY pyproject.toml uv.lock ./
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
RUN uv sync --locked --no-dev --no-install-project --python /usr/local/bin/python

FROM python:3.12.13-slim-bookworm@sha256:4766d8b510c428e595d74b9cc5bbb2fae8e26316fffb4adc89908d79aacd58a2
COPY --from=dependencies /opt/venv /opt/venv
WORKDIR /opt/acceptances/tools/jev-browser
COPY jev_browser.py chrome.py path_contract.py ./
ENV PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    JEV_STATE_DIR=/tmp/jev-harness JEV_OUTPUT_DIR=/evidence HOME=/tmp/jev-home
USER 10001:10001
ENTRYPOINT ["python", "/opt/acceptances/tools/jev-browser/jev_browser.py"]
CMD ["doctor"]
