#!/usr/bin/env bash
# Source this in Git Bash to put the project toolchain on PATH:  source scripts/dev-env.sh
NODE_DIR="/c/Users/Dflame/AppData/Local/Microsoft/WinGet/Packages/OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe/node-v24.19.0-win-x64"
PY_DIR="/c/Users/Dflame/AppData/Local/Programs/Python/Python312"
export PATH="$NODE_DIR:$PY_DIR:$PY_DIR/Scripts:$HOME/.foundry/bin:$PATH"
