#!/usr/bin/env python3
"""Daemonized restart of the DSH web profile.

Kills the process listening on DSH_WEB_PORT (default 3080) and relaunches the
profile detached, then polls until the web server answers again.

Why daemonized: the web GUI hosts the harness process that may be running this
script's parent, so the restarter must fully detach (fork -> setsid -> fork,
new session, stdio to a log) before killing anything — otherwise it dies with
its parent.

Configuration via environment:
  DSH_WEB_PORT    port to watch (default 3080)
  DSH_NODE_BIN    node binary (default /Users/admin/.hermes/node/bin/node)
  DSH_DSH_BIN     dsh launcher (default the npx-installed @deepseek-ai/dsh)
  DSH_PROFILE     profile name (default web)
  DSH_CWD         working directory for the relaunch (default /Users/admin/Code)
  DSH_RESTART_LOG log path (default /tmp/dsh-web-restart.log)
  DSH_DELAY       seconds to wait before acting (default 0)
"""
import os
import socket
import subprocess
import sys
import time

PORT = int(os.environ.get("DSH_WEB_PORT", "3080"))
HOST = "127.0.0.1"
NODE_BIN = os.environ.get("DSH_NODE_BIN", "/Users/admin/.hermes/node/bin/node")
DSH_BIN = os.environ.get(
    "DSH_DSH_BIN",
    "/Users/admin/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh/lib/bin.js",
)
PROFILE = os.environ.get("DSH_PROFILE", "web")
CWD = os.environ.get("DSH_CWD", "/Users/admin/Code")
LOG = os.environ.get("DSH_RESTART_LOG", "/tmp/dsh-web-restart.log")
DELAY = float(os.environ.get("DSH_DELAY", "0"))


def log(msg):
    with open(LOG, "a") as fh:
        fh.write("%s\n" % msg)


def pid_on_port(port):
    try:
        out = subprocess.check_output(
            ["lsof", "-tnP", "-iTCP:%d" % port, "-sTCP:LISTEN"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return None
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return lines[0] if lines else None


def port_free(port):
    return pid_on_port(port) is None


def wait_port_free(port, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_free(port):
            return True
        time.sleep(0.2)
    return False


def web_up(port):
    """Minimal HTTP GET probe (raw socket: urllib is unreliable here)."""
    try:
        with socket.create_connection((HOST, port), timeout=2) as sock:
            sock.sendall(b"GET / HTTP/1.1\r\nHost: %s:%d\r\nConnection: close\r\n\r\n" % (HOST.encode(), port))
            sock.settimeout(3)
            data = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                data += chunk
        return data.startswith(b"HTTP/1.1 200")
    except Exception:
        return False


def daemonize():
    logfd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    if os.fork() > 0:
        os._exit(0)
    os.setsid()
    if os.fork() > 0:
        os._exit(0)
    os.chdir("/")
    os.dup2(logfd, 0)
    os.dup2(logfd, 1)
    os.dup2(logfd, 2)
    if logfd > 2:
        os.close(logfd)


def main():
    if DELAY > 0:
        time.sleep(DELAY)

    pid = pid_on_port(PORT)
    if pid is None:
        log("restart: no process listening on %s:%d — nothing to kill" % (HOST, PORT))
    else:
        log("restart: killing pid %s on %s:%d" % (pid, HOST, PORT))
        try:
            os.kill(int(pid), 15)  # SIGTERM
        except OSError as exc:
            log("restart: kill failed: %s" % exc)
        if not wait_port_free(PORT, 10):
            try:
                os.kill(int(pid), 9)  # SIGKILL
            except OSError as exc:
                log("restart: SIGKILL failed: %s" % exc)
            if not wait_port_free(PORT, 5):
                log("restart: ABORT — port %d still occupied, refusing to spawn a second instance" % PORT)
                return 2
        log("restart: port %d free" % PORT)

    log("restart: relaunching dsh --profile %s from %s" % (PROFILE, CWD))
    child = subprocess.Popen(
        [NODE_BIN, DSH_BIN, "--profile", PROFILE],
        cwd=CWD,
        stdin=subprocess.DEVNULL,
        stdout=open(LOG, "a"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )

    deadline = time.time() + 120
    while time.time() < deadline:
        if web_up(PORT):
            log("restart: OK — %s:%d answering (dsh pid %d)" % (HOST, PORT, child.pid))
            return 0
        time.sleep(0.5)
    log("restart: FAILED — %s:%d did not come up (dsh pid %d)" % (HOST, PORT, child.pid))
    return 1


if __name__ == "__main__":
    daemonize()
    sys.exit(main())
