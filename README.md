## TODO

- find better voice model

## Setup

### System

Setup Jetson with JetPack 6.0

### Dependencies

```bash
sudo apt-get update
sudo apt-get install -y protobuf-compiler

# some more
```

### Install Riva Speech Starter Kit

[doc](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/quick-start-guide.html)

### Install Node

```bash
# grab nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# reload shell
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh"

# install the latest LTS (Node 22 today)
nvm install --lts
nvm use --lts

node -v   # v22.x.y

corepack enable   # turns on pnpm & friends
corepack prepare pnpm@latest --activate  # install pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
```
