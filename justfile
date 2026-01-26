# List available commands
# Docker image name
# Install dependencies
# Smoke test - verify TypeScript/Node tools are installed

default:
	@just --list

DOCKER_IMAGE := "ear-trainer-dev"

_docker-build:
	#!/usr/bin/env bash
	set -e
	HASH=$(cat .devcontainer/Dockerfile | sha256sum | cut -d' ' -f1)
	SENTINEL=".devcontainer/.docker-build-hash"
	CACHED_HASH=""
	if [ -f "$SENTINEL" ]; then
		CACHED_HASH=$(cat "$SENTINEL")
	fi
	if [ "$HASH" != "$CACHED_HASH" ]; then
		echo "Dockerfile changed, rebuilding image..."
		docker build -t {{DOCKER_IMAGE}} -f .devcontainer/Dockerfile .
		echo "$HASH" > "$SENTINEL"
	fi

build:
	npm run build

check: lint test

clean:
	rm -rf dist/ node_modules/.cache/ coverage/

develop *ARGS:
	#!/usr/bin/env bash
	set -e

	# Validate devcontainer configuration exists
	if [ ! -f .devcontainer/devcontainer.json ]; then
		echo "Error: .devcontainer/devcontainer.json not found"
		exit 1
	fi
	if [ ! -f .devcontainer/Dockerfile ]; then
		echo "Error: .devcontainer/Dockerfile not found"
		exit 1
	fi
	# Validate JSON syntax
	python3 -c "import json; json.load(open('.devcontainer/devcontainer.json'))"

	# Build image if needed
	just _docker-build

	# Run host initialization
	bash .devcontainer/initialize.sh

	# Generate GitHub token if GitHub App is configured
	bash .devcontainer/scripts/generate-github-token.sh

	# Start token refresh daemon if not already running
	# The daemon runs on the host and refreshes the token before it expires
	DAEMON_PID_FILE=".devcontainer/.credentials/daemon.pid"
	DAEMON_SCRIPT=".devcontainer/token-refresh-daemon.py"
	if [ -f "$DAEMON_SCRIPT" ]; then
		NEED_DAEMON="yes"
		if [ -f "$DAEMON_PID_FILE" ]; then
			OLD_PID=$(cat "$DAEMON_PID_FILE" 2>/dev/null)
			if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
				echo "Token refresh daemon already running (PID $OLD_PID)"
				NEED_DAEMON="no"
			else
				# Stale PID file, clean up
				rm -f "$DAEMON_PID_FILE"
			fi
		fi
		if [ "$NEED_DAEMON" = "yes" ]; then
			echo "Starting token refresh daemon..."
			python3 "$DAEMON_SCRIPT" --daemon
		fi
	fi

	# Extract Claude credentials from macOS
	# Claude Code needs two things:
	# 1. OAuth tokens from Keychain -> .credentials.json
	# 2. Config file with oauthAccount -> .claude.json (tells Claude who is logged in)
	CLAUDE_CREDS_DIR="$(pwd)/.devcontainer/.credentials"
	mkdir -p "$CLAUDE_CREDS_DIR"

	if command -v security &> /dev/null; then
		echo "Extracting Claude credentials from macOS..."

		# Extract OAuth tokens from Keychain
		CLAUDE_KEYCHAIN_FILE="$CLAUDE_CREDS_DIR/claude-keychain.json"
		security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null > "$CLAUDE_KEYCHAIN_FILE" || true
		if [ -s "$CLAUDE_KEYCHAIN_FILE" ]; then
			echo "  OAuth tokens: $(wc -c < "$CLAUDE_KEYCHAIN_FILE") bytes"
		else
			echo "  WARNING: No OAuth tokens in Keychain"
			echo "  Run 'claude' on macOS and log in first"
			rm -f "$CLAUDE_KEYCHAIN_FILE"
		fi

		# Copy Claude config file (contains oauthAccount which identifies logged-in user)
		CLAUDE_CONFIG_FILE="$CLAUDE_CREDS_DIR/claude-config.json"
		if [ -f "$HOME/.claude/.claude.json" ]; then
			cp "$HOME/.claude/.claude.json" "$CLAUDE_CONFIG_FILE"
			echo "  Config file: copied from ~/.claude/.claude.json"
		elif [ -f "$HOME/.claude.json" ]; then
			cp "$HOME/.claude.json" "$CLAUDE_CONFIG_FILE"
			echo "  Config file: copied from ~/.claude.json"
		else
			echo "  WARNING: No Claude config file found"
			echo "  Run 'claude' on macOS and complete login first"
		fi
	else
		echo "Note: Not running on macOS, skipping credential extraction"
	fi

	# Extract git identity from host for use in container
	GIT_USER_NAME=$(git config --global user.name 2>/dev/null || echo "")
	GIT_USER_EMAIL=$(git config --global user.email 2>/dev/null || echo "")

	# Detect terminal background color mode
	THEME="light-ansi"
	if [ -n "$COLORFGBG" ]; then
		BG=$(echo "$COLORFGBG" | cut -d';' -f2)
		if [ "$BG" -lt 7 ] 2>/dev/null; then
			THEME="dark-ansi"
		fi
	elif [ "$TERM_BACKGROUND" = "dark" ]; then
		THEME="dark-ansi"
	fi

	# Determine command to run
	if [ -z "{{ARGS}}" ]; then
		SETTINGS="{\"theme\":\"$THEME\"}"
		DOCKER_CMD="claude --dangerously-skip-permissions --settings '$SETTINGS'"
	else
		DOCKER_CMD="{{ARGS}}"
	fi

	# Detect if we have a TTY for interactive mode
	if [ -t 0 ]; then
		INTERACTIVE_FLAGS="-it"
	else
		INTERACTIVE_FLAGS="-t"
	fi

	# Run container with all necessary mounts
	# UV_PROJECT_ENVIRONMENT puts virtualenv in /home/dev (a volume) to avoid host/container conflicts
	# This also allows hardlinks to work since venv and uv cache are on the same filesystem
	docker run $INTERACTIVE_FLAGS --rm \
		-v "$(pwd):/workspaces/ear-trainer" \
		-v "$(pwd)/.devcontainer/.credentials:/mnt/credentials:ro" \
		-v "$(pwd)/.devcontainer/.ssh:/mnt/ssh-keys" \
		-v "ear-trainer-home:/home/dev" \
		-v "ear-trainer-.cache:/workspaces/ear-trainer/.cache" \
		-e ANTHROPIC_API_KEY= \
		-e UV_PROJECT_ENVIRONMENT=/home/dev/venvs/ear-trainer \
		-e GIT_USER_NAME="$GIT_USER_NAME" \
		-e GIT_USER_EMAIL="$GIT_USER_EMAIL" \
		-w /workspaces/ear-trainer \
		--user dev \
		--entrypoint /workspaces/ear-trainer/.devcontainer/entrypoint.sh \
		{{DOCKER_IMAGE}} \
		bash -c "$DOCKER_CMD"

format:
	npm run format

install:
	npm install

lint:
	npm run lint

smoke-test:
	#!/usr/bin/env bash
	set -e
	echo "Checking essential tools..."
	command -v just >/dev/null || { echo "ERROR: just not installed"; exit 1; }
	command -v git >/dev/null || { echo "ERROR: git not installed"; exit 1; }
	command -v claude >/dev/null || { echo "ERROR: claude not installed"; exit 1; }
	# Run language-specific smoke tests if they exist
	for recipe in $(just --list --unsorted 2>/dev/null | grep '^smoke-test-' | awk '{print $1}'); do
		echo "Running $recipe..."
		just "$recipe"
	done
	echo "All essential tools present"

smoke-test-typescript:
	#!/usr/bin/env bash
	set -e
	command -v node >/dev/null || { echo "ERROR: node not installed"; exit 1; }
	command -v npm >/dev/null || { echo "ERROR: npm not installed"; exit 1; }
	node --version
	echo "TypeScript/Node tools present"

test *ARGS:
	npm run test -- {{ARGS}}

test-cov:
	npm run test:cov

test-watch:
	npm run test:watch

validate-devcontainer:
	@test -f .devcontainer/devcontainer.json && test -f .devcontainer/Dockerfile && echo "Devcontainer configuration valid"
