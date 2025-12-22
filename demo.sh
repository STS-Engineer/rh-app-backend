#!/bin/bash
set -e

echo "Startup script: installing LibreOffice if missing..."

if ! command -v libreoffice >/dev/null 2>&1; then
  apt-get update
  apt-get -y install libreoffice
else
  echo "LibreOffice already installed."
fi

echo "Startup script done."
