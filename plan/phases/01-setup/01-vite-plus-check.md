# 1.1 Vite+ check

**Status:** done
**Phase:** 01-setup

## Goal

Confirm Vite+ works from the VS Code terminal, and get to know its commands before using them for real.

## In scope

- `vp` on PATH in VS Code's terminal (PowerShell).
- Tour: `vp --help`, `vp --version`, `vp env`, and what each top-level command does.
- Choose the package manager Vite+ will use for this project.

## Out of scope

- Creating the project (1.2).

## Sources

- https://viteplus.dev/guide/
- Already installed by Damion: `vp` v1.3.0 at `C:\Users\damio\AppData\Local\vite-plus\bin`, Node v24.22.0.

## Files

None.

## Steps

- [x] Restart VS Code so the terminal picks up the new user PATH (`vp` isn't found in sessions opened before the install).
- [x] `vp --version` shows v1.3.0.
- [x] `vp --help`: note the commands for the recording (`create`, `migrate`, `install`, `dev`, `check`, `test`, `build`, `pack`, `env`, `upgrade`).
- [x] `vp env`: see how Vite+ manages Node and the package manager.
- [x] Pick the package manager: **pnpm** (my call, because Vite+ manages it and it's fast on Windows). Use npm only if pnpm causes trouble.

## Done when

- [x] `vp --version` works in a fresh VS Code terminal.
- [x] The package manager choice is written into this file.

## Results (24 Oct 2026)

- `vp` v1.3.0 at `C:\Users\damio\AppData\Local\vite-plus\bin\vp.exe`, on PATH in PowerShell.
- `vp env doctor`: all checks pass. Node and the package manager are in **managed mode**. Node resolves to **v24.22.1** (LTS; v24.22.0 is also installed).
- `node`/`npm`/`npx` on PATH are the system install in `C:\Program Files\nodejs`, not Vite+ shims. That's harmless: `vp` commands use the managed Node.
- Installed package managers: pnpm 10.33.0 and 12.15.0. No package manager is selected outside a project yet. 1.2 pins one in `package.json`.
- **Package manager: pnpm** (the version `vp create` picks; it gets pinned in `packageManager`).
- Command groups from `vp --help`, for the recording:

  | Group | Commands |
  |---|---|
  | Start | `create`, `migrate`, `config`, `hooks`, `staged`, `install`, `env` |
  | Develop | `dev`, `check`, `lint`, `fmt`, `test` |
  | Execute | `run` (`vpr`), `exec`, `node`, `dlx`, `cache` |
  | Build | `build`, `pack`, `preview` |
  | Dependencies | `add`, `remove`, `update`, `outdated`, `why`, … |
  | Maintain | `toolchain`, `upgrade`, `implode` |

## Commit message

None (nothing changes in the repo).
