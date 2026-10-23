"""Resolve an explicitly selected real Chrome endpoint, without browser discovery."""

import os
import re
import socket
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


def validate_endpoint(value):
    try:
        parsed = urlsplit(value)
        port = parsed.port
        valid = (
            parsed.scheme in {"http", "https", "ws", "wss"}
            and parsed.hostname
            and not parsed.username
            and not parsed.password
            and not parsed.query
            and not parsed.fragment
            and (port is None or 1 <= port <= 65535)
            and (parsed.scheme in {"http", "https"} or parsed.path.startswith("/devtools/browser/"))
        )
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("JEV_CHROME_CDP_URL 需要不含凭据或查询参数的 Chrome HTTP/WS 调试地址")
    return value


def chrome_endpoint(environ=None, *, resolve_docker_host=False):
    environ = os.environ if environ is None else environ
    if explicit := environ.get("JEV_CHROME_CDP_URL", "").strip():
        parsed = urlsplit(validate_endpoint(explicit))
        # Chrome rejects a non-localhost DNS name in the Host header. Resolve
        # Docker's local gateway inside the container, then connect to its IP.
        if (
            resolve_docker_host
            and parsed.hostname == "host.docker.internal"
            and parsed.scheme in {"ws", "http"}
        ):
            try:
                authority = socket.gethostbyname(parsed.hostname)
            except OSError:
                raise ValueError(
                    "容器无法解析 host.docker.internal，请检查 Docker 宿主机网络"
                ) from None
            if parsed.port:
                authority += f":{parsed.port}"
            return urlunsplit(parsed._replace(netloc=authority))
        return explicit
    if sys.platform == "darwin":
        directory = Path.home() / "Library/Application Support/Google/Chrome"
    elif sys.platform == "linux":
        directory = Path.home() / ".config/google-chrome"
    else:
        raise ValueError("请通过 JEV_CHROME_CDP_URL 指定真实 Chrome 调试地址")
    try:
        lines = (directory / "DevToolsActivePort").read_text().splitlines()
    except FileNotFoundError:
        raise ValueError("请在 Chrome 的 chrome://inspect/#remote-debugging 开启远程调试") from None
    if (
        len(lines) < 2
        or not lines[0].isdigit()
        or not 1 <= int(lines[0]) <= 65535
        or not re.fullmatch(r"/devtools/browser/[A-Za-z0-9-]+", lines[1])
    ):
        raise ValueError("Chrome 的 DevToolsActivePort 无效；请检查当前浏览器调试设置")
    return f"ws://127.0.0.1:{lines[0]}{lines[1]}"


def container_endpoint(value):
    parsed = urlsplit(validate_endpoint(value))
    if sys.platform != "linux" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}:
        authority = "host.docker.internal"
        if parsed.port:
            authority += f":{parsed.port}"
        return urlunsplit(parsed._replace(netloc=authority))
    return value
