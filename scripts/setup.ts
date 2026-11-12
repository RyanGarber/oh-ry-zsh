#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { arch, homedir, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { cancel, confirm, isCancel, select } from "@clack/prompts";
import {
	assetSuffix,
	copyTree,
	exists,
	hasCommand,
	installBinary,
	managedBlock,
	OMZ_PLUGINS,
	type OS,
	paths,
	readOptional,
	run,
	type Shell,
	save,
	shellQuote,
} from "./setup-lib.ts";

const { values } = parseArgs({
	options: {
		shell: { type: "string" },
		yes: { type: "boolean", short: "y" },
		"no-omz": { type: "boolean" },
		"no-aliases": { type: "boolean" },
		help: { type: "boolean", short: "h" },
	},
});
if (values.help) {
	console.log(
		"Usage: pnpm setup [--shell zsh|bash] [--yes] [--no-omz] [--no-aliases]\nInstalls per-user binaries and backed-up configuration. Requires Node 22.18+ and Git.\nWindows requires Git Bash. --yes accepts defaults; it does not change the login shell.",
	);
	process.exit(0);
}

function answer<T>(value: T): Exclude<T, symbol> {
	if (isCancel(value)) {
		cancel("Setup cancelled.");
		process.exit(0);
	}
	return value as Exclude<T, symbol>;
}
async function ask(message: string) {
	return values.yes
		? true
		: answer(await confirm({ message, initialValue: true }));
}

async function main() {
	const os = platform();
	if (os !== "darwin" && os !== "linux" && os !== "win32")
		throw new Error(`Unsupported platform: ${os}`);
	if (values.shell && values.shell !== "zsh" && values.shell !== "bash")
		throw new Error("--shell must be zsh or bash");
	if (!values.yes && !process.stdin.isTTY)
		throw new Error(
			"Interactive setup requires a terminal; use --yes for unattended setup.",
		);
	const shell: Shell =
		(values.shell as Shell | undefined) ??
		(os === "win32"
			? "bash"
			: values.yes
				? "zsh"
				: answer(
						await select({
							message: "Shell to configure",
							options: [
								{ label: "zsh", value: "zsh" },
								{ label: "bash", value: "bash" },
							],
						}),
					));
	if (os === "win32" && shell !== "bash")
		throw new Error(
			"Windows setup supports Git Bash; run setup inside WSL for zsh.",
		);
	// Fail unsupported release targets before making changes.
	assetSuffix("bat", os, arch());
	assetSuffix("micro", os, arch());
	const home = homedir();
	const root = resolve(import.meta.dirname, "..");
	const assets = join(root, "assets");
	const locations = paths(os, home);
	const backupRoot = join(
		home,
		".local",
		"state",
		"oh-ry-zsh",
		"backups",
		`${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`,
	);
	const omzPath = join(home, ".oh-my-zsh");
	const omz =
		shell === "zsh" &&
		!values["no-omz"] &&
		((await exists(join(omzPath, "oh-my-zsh.sh"))) ||
			(await ask("Install Oh My Zsh?")));
	const aliases =
		!values["no-aliases"] && (await ask("Install cat/nano aliases?"));
	if (!hasCommand("git", os))
		throw new Error("Install Git first (Git for Windows includes Bash).");
	if (os === "win32" && !hasCommand("cygpath", os))
		throw new Error("Run Windows setup from Git Bash with cygpath on PATH.");
	if (!hasCommand(shell, os)) await installShell(shell, os);
	if (os !== "win32" && !hasCommand("tar", os))
		throw new Error("Install tar before running setup.");

	const temp = await mkdtemp(join(tmpdir(), "oh-ry-zsh-"));
	try {
		if (omz) {
			console.log("Updating submodules to their latest remote commits...");
			run("git", [
				"-C",
				root,
				"submodule",
				"update",
				"--init",
				"--recursive",
				"--remote",
			]);
			if (!(await exists(join(omzPath, "oh-my-zsh.sh")))) {
				if (await exists(omzPath))
					throw new Error(
						`${omzPath} exists but is not a valid Oh My Zsh installation.`,
					);
				run("git", [
					"clone",
					"--depth=1",
					"https://github.com/ohmyzsh/ohmyzsh.git",
					omzPath,
				]);
			}
			for (const plugin of OMZ_PLUGINS) {
				const source = join(
					assets,
					".oh-my-zsh",
					"custom",
					"plugins",
					plugin.source,
				);
				const entrypoint = join(source, `${plugin.name}.plugin.zsh`);
				if (!(await exists(entrypoint)))
					throw new Error(`Missing plugin: ${plugin.name}`);
				await copyTree(
					source,
					join(omzPath, "custom", "plugins", plugin.name),
					backupRoot,
				);
			}
			await copyTree(
				join(assets, ".oh-my-zsh", "custom", "themes"),
				join(omzPath, "custom", "themes"),
				backupRoot,
			);
		}
		const bat = await installBinary(
			"bat",
			os,
			arch(),
			locations.bin,
			temp,
			backupRoot,
		);
		await installBinary("micro", os, arch(), locations.bin, temp, backupRoot);
		await copyTree(join(assets, ".config", "bat"), locations.bat, backupRoot);
		await copyTree(
			join(assets, ".config", "micro"),
			locations.micro,
			backupRoot,
		);
		await save(
			join(home, ".oh-ry-zsh"),
			await readOptional(join(assets, ".oh-ry-zsh")),
			backupRoot,
		);
		const env = {
			...process.env,
			BAT_CONFIG_DIR: locations.bat,
			BAT_CONFIG_PATH: join(locations.bat, "config"),
			MICRO_CONFIG_HOME: locations.micro,
		};
		run(bat, ["cache", "--build"], env);

		// Git Bash uses POSIX paths; cygpath handles drive letters, spaces, and non-default AppData locations.
		const pathExpr = (path: string) =>
			os === "win32" ? `"$(cygpath -u ${shellQuote(path)})"` : shellQuote(path);
		const configExpr = (path: string) =>
			shellQuote(os === "win32" ? path.replaceAll("\\", "/") : path);
		const body = `export OH_RY_ZSH_BIN=${pathExpr(locations.bin)}
case ":$PATH:" in *":$OH_RY_ZSH_BIN:"*) ;; *) export PATH="$OH_RY_ZSH_BIN:$PATH" ;; esac
export BAT_CONFIG_DIR=${configExpr(locations.bat)}
export BAT_CONFIG_PATH="$BAT_CONFIG_DIR/config"
export MICRO_CONFIG_HOME=${configExpr(locations.micro)}
export OH_RY_ZSH_ALIAS=${aliases ? "1" : "0"}
export OH_RY_ZSH_OMZ=${omz ? "1" : "0"}
source ~/.oh-ry-zsh`;
		const rc = join(
			shell === "zsh" ? process.env.ZDOTDIR || home : home,
			shell === "zsh" ? ".zshrc" : ".bashrc",
		);
		await save(rc, managedBlock(await readOptional(rc), body), backupRoot);
		if (shell === "bash") {
			// Bash reads only the first existing login file, so preserve that precedence.
			let profile = join(home, ".bash_profile");
			for (const name of [".bash_profile", ".bash_login", ".profile"]) {
				if (await exists(join(home, name))) {
					profile = join(home, name);
					break;
				}
			}
			const content = await readOptional(profile);
			if (!/^\s*(?:source|\.)\s+[^\n;]*\.bashrc/m.test(content)) {
				await save(
					profile,
					managedBlock(
						content,
						// biome-ignore lint/suspicious/noTemplateCurlyInString: expanded by the login shell.
						'if [ -n "${BASH_VERSION:-}" ] && [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi',
					),
					backupRoot,
				);
			}
		}
		if (os === "win32") {
			run(
				"powershell.exe",
				[
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					`
$ErrorActionPreference = 'Stop'
$bin = $env:OH_RY_INSTALL_BIN
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $bin) {
  [Environment]::SetEnvironmentVariable('Path', ($bin + ';' + $userPath), 'User')
}
[Environment]::SetEnvironmentVariable('BAT_CONFIG_DIR', $env:BAT_CONFIG_DIR, 'User')
[Environment]::SetEnvironmentVariable('BAT_CONFIG_PATH', $env:BAT_CONFIG_PATH, 'User')
[Environment]::SetEnvironmentVariable('MICRO_CONFIG_HOME', $env:MICRO_CONFIG_HOME, 'User')
`,
				],
				{ ...env, OH_RY_INSTALL_BIN: locations.bin },
			);
		}
		console.log(
			`Setup complete. Binaries: ${locations.bin}\nOpen a new ${shell} session or run: source ${shellQuote(rc)}\nExisting files that changed were backed up under ${backupRoot}`,
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}

async function installShell(shell: Shell, os: OS) {
	if (os === "win32")
		throw new Error("Install Git for Windows and run setup from Git Bash.");
	if (os === "darwin") {
		if (!hasCommand("brew", os))
			throw new Error(`Install ${shell} or Homebrew before running setup.`);
		run("brew", ["install", shell]);
	} else {
		const managers: [string, string[]][] = [
			["apt-get", ["install", "-y"]],
			["dnf", ["install", "-y"]],
			["pacman", ["-S", "--needed", "--noconfirm"]],
			["apk", ["add"]],
			["zypper", ["--non-interactive", "install"]],
		];
		const manager = managers.find(([name]) => hasCommand(name, os));
		if (!manager)
			throw new Error(
				`Install ${shell} using your distribution's package manager first.`,
			);
		const [name, args] = manager;
		if (process.getuid?.() === 0) run(name, [...args, shell]);
		else run("sudo", [name, ...args, shell]);
	}
	if (!hasCommand(shell, os))
		throw new Error(
			`${shell} is still unavailable on PATH after installation.`,
		);
}

await main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
