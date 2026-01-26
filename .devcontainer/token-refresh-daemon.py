#!/usr/bin/env python3
"""
Token refresh daemon for devcontainer GitHub credentials.

This script runs on the HOST machine and automatically refreshes the GitHub
installation token before it expires. The token is written to the credentials
file that's bind-mounted into the container.

Usage:
    # Run in foreground (for testing):
    python token-refresh-daemon.py

    # Run as a background daemon:
    python token-refresh-daemon.py --daemon

    # Refresh token once and exit:
    python token-refresh-daemon.py --refresh-now
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

# Refresh token when less than this many hours remain (tokens last 8 hours max)
REFRESH_THRESHOLD_HOURS = 2

# Check interval in seconds (every 5 minutes)
CHECK_INTERVAL_SECONDS = 300


def get_script_dir() -> Path:
    """Get the directory containing this script."""
    return Path(__file__).parent.resolve()


def get_project_dir() -> Path:
    """Get the project root directory."""
    return get_script_dir().parent


def get_credentials_file() -> Path:
    """Get the path to the credentials file."""
    return get_script_dir() / ".credentials" / "github_token.json"


def get_token_expiry() -> datetime | None:
    """Read the current token expiry time."""
    creds_file = get_credentials_file()
    if not creds_file.exists():
        return None

    try:
        data = json.loads(creds_file.read_text())
        expires_at = data.get("expires_at")
        if expires_at:
            return datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except (json.JSONDecodeError, ValueError):
        pass

    return None


def refresh_token() -> bool:
    """Refresh the GitHub token by running the token generation script."""
    script_dir = get_script_dir()
    token_script = script_dir / "scripts" / "generate-github-token.sh"

    if not token_script.exists():
        print(f"Error: {token_script} not found", file=sys.stderr)
        return False

    try:
        result = subprocess.run(
            ["bash", str(token_script)],
            cwd=get_project_dir(),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            print(f"Token refresh failed: {result.stderr}", file=sys.stderr)
            return False

        print(f"Token refreshed at {datetime.now(UTC).isoformat()}")
        return True
    except subprocess.TimeoutExpired:
        print("Token refresh timed out", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Token refresh error: {e}", file=sys.stderr)
        return False


def should_refresh() -> bool:
    """Check if the token needs refreshing."""
    expiry = get_token_expiry()
    if expiry is None:
        return True

    now = datetime.now(UTC)
    remaining_hours = (expiry - now).total_seconds() / 3600

    if remaining_hours < REFRESH_THRESHOLD_HOURS:
        print(f"Token expires in {remaining_hours:.1f} hours, refreshing...")
        return True

    return False


def run_daemon() -> None:
    """Run the token refresh daemon loop."""
    print(f"Token refresh daemon started (PID {os.getpid()})")
    interval = CHECK_INTERVAL_SECONDS
    threshold = REFRESH_THRESHOLD_HOURS
    print(f"Check every {interval}s, refresh when < {threshold}h remain")

    # Handle graceful shutdown
    running = True

    def handle_signal(signum: int, frame: object) -> None:
        nonlocal running
        print(f"\nReceived signal {signum}, shutting down...")
        running = False

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    while running:
        try:
            if should_refresh():
                refresh_token()
        except Exception as e:
            print(f"Error in daemon loop: {e}", file=sys.stderr)

        # Sleep in small increments to respond to signals quickly
        for _ in range(CHECK_INTERVAL_SECONDS):
            if not running:
                break
            time.sleep(1)

    print("Daemon stopped")


def daemonize() -> None:
    """Fork into background daemon process."""
    # First fork
    pid = os.fork()
    if pid > 0:
        print(f"Daemon started with PID {pid}")
        sys.exit(0)

    # Decouple from parent environment
    os.chdir("/")
    os.setsid()
    os.umask(0)

    # Second fork
    pid = os.fork()
    if pid > 0:
        sys.exit(0)

    # Redirect standard file descriptors
    sys.stdout.flush()
    sys.stderr.flush()

    with open("/dev/null") as devnull:
        os.dup2(devnull.fileno(), sys.stdin.fileno())

    log_file = get_script_dir() / ".credentials" / "daemon.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    with open(log_file, "a") as log:
        os.dup2(log.fileno(), sys.stdout.fileno())
        os.dup2(log.fileno(), sys.stderr.fileno())

    # Write PID file
    pid_file = get_script_dir() / ".credentials" / "daemon.pid"
    pid_file.write_text(str(os.getpid()))

    run_daemon()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Token refresh daemon for devcontainer GitHub credentials"
    )
    parser.add_argument(
        "--daemon",
        "-d",
        action="store_true",
        help="Run as a background daemon",
    )
    parser.add_argument(
        "--refresh-now",
        action="store_true",
        help="Refresh token immediately and exit",
    )

    args = parser.parse_args()

    if args.refresh_now:
        if refresh_token():
            print("Token refreshed successfully")
        else:
            sys.exit(1)
    elif args.daemon:
        daemonize()
    else:
        run_daemon()


if __name__ == "__main__":
    main()
