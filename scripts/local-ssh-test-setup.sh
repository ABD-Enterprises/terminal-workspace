#!/usr/bin/env bash
set -euo pipefail

docker run -d   --name local-ssh-test   -p 2222:22   -e USER_NAME=tester   -e USER_PASSWORD=tester   -e PASSWORD_ACCESS=true   lscr.io/linuxserver/openssh-server:latest
