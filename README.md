# oh-ry-zsh

Houston themes, shell aliases, and optional Oh My Zsh plugins for macOS, Linux, and Windows Git Bash.

Requires Node.js 22.18+ (or a newer release with native TypeScript support), pnpm, and Git. Windows setup runs with native Windows Node.js from Git Bash. Run separately inside WSL to configure its Linux environment.

```sh
pnpm install
pnpm setup
```

Choose Bash or Zsh, whether to install Oh My Zsh when missing, and whether to enable the `cat` → `batcat` and `nano` → `micro` aliases. For unattended setup:

```sh
pnpm setup --shell zsh --yes
pnpm setup --shell bash --yes --no-omz --no-aliases
```

The installer downloads the latest stable upstream bat and micro binaries for the current OS and architecture. It installs both `bat` and `batcat` names. Linux uses musl bat builds and micro's static x64 build; other CPUs use their available upstream builds. Missing Unix shells are installed using Homebrew or a supported Linux package manager, which may require sudo.

| Files                      | macOS / Linux           | Windows                                   |
| -------------------------- | ----------------------- | ----------------------------------------- |
| Binaries                   | `~/.local/bin`          | `%LOCALAPPDATA%\Programs\oh-ry-zsh\bin`   |
| bat configuration          | `~/.local/config/bat`   | `%APPDATA%\bat` (settings file: `config`) |
| micro configuration        | `~/.local/config/micro` | `~/.local/config/micro`                   |
| Shared shell setup         | `~/.oh-ry-zsh`          | `~/.oh-ry-zsh`                            |
| Optional plugins and theme | `~/.oh-my-zsh/custom`   | Not installed; use WSL for Zsh            |

The selected shell's startup file receives a managed block containing PATH, bat/micro config paths, `OH_RY_ZSH_ALIAS`, `OH_RY_ZSH_OMZ`, and `source ~/.oh-ry-zsh`. Zsh honors `ZDOTDIR`; Bash login profiles are connected to `.bashrc`. Windows also gets persistent user PATH and config environment variables for use outside Git Bash.

Open a new shell or source the startup file printed by setup. The installer does not change your login shell. When Oh My Zsh is enabled, it updates all submodules recursively to their latest remote commits before copying plugins and themes. It rebuilds bat's theme cache, preserves unrelated destination files, and backs up changed files under `~/.local/state/oh-ry-zsh/backups`. Repeated runs replace the managed block rather than appending duplicates. Existing file symlinks are left for you to resolve rather than overwritten.

```sh
pnpm test
pnpm typecheck
```
