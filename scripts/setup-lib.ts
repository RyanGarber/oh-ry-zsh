import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, win32 } from "node:path";

export type OS = "darwin" | "linux" | "win32";
export type Shell = "zsh" | "bash";
export const OMZ_PLUGINS = [
	{ source: "history-substring-search", name: "zsh-history-substring-search" },
	{ source: "zsh-autosuggestions", name: "zsh-autosuggestions" },
	{ source: "zsh-syntax-highlighting", name: "zsh-syntax-highlighting" },
] as const;
const START = "# >>> oh-ry-zsh >>>";
const END = "# <<< oh-ry-zsh <<<";

export function paths(
	os: OS,
	home: string,
	env: NodeJS.ProcessEnv = process.env,
) {
	const p = os === "win32" ? win32 : { join };
	return {
		bin:
			os === "win32"
				? p.join(
						env.LOCALAPPDATA || p.join(home, "AppData", "Local"),
						"Programs",
						"oh-ry-zsh",
						"bin",
					)
				: p.join(home, ".local", "bin"),
		bat:
			os === "win32"
				? p.join(env.APPDATA || p.join(home, "AppData", "Roaming"), "bat")
				: p.join(home, ".local", "config", "bat"),
		micro: p.join(home, ".local", "config", "micro"),
	};
}

export function shellQuote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function managedBlock(content: string, body: string) {
	const start = content.indexOf(START);
	const end = content.indexOf(END);
	const block = `${START}\n${body.trim()}\n${END}`;
	if (start < 0 && end < 0)
		return `${content}${content.endsWith("\n") || !content ? "" : "\n"}\n${block}\n`;
	if (
		start < 0 ||
		end < start ||
		content.indexOf(START, start + START.length) >= 0 ||
		content.indexOf(END, end + END.length) >= 0
	) {
		throw new Error(
			"Malformed oh-ry-zsh startup block; repair its markers before rerunning setup.",
		);
	}
	return content.slice(0, start) + block + content.slice(end + END.length);
}

export async function exists(path: string) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export async function readOptional(path: string) {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
}

// Save only files that actually change, and retain unrelated files in destination directories.
export async function save(
	path: string,
	data: string | Uint8Array,
	backupRoot: string,
) {
	if (await exists(path)) {
		if ((await lstat(path)).isSymbolicLink())
			throw new Error(`Refusing to overwrite symlink: ${path}`);
		const old = await readFile(path);
		if (old.equals(Buffer.from(data))) return;
		const backup = join(
			backupRoot,
			createHash("sha256").update(path).digest("hex").slice(0, 16),
			basename(path),
		);
		await mkdir(dirname(backup), { recursive: true });
		await copyFile(path, backup);
		console.log(`Backed up ${path} to ${backup}`);
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, data);
}

export async function copyTree(
	source: string,
	destination: string,
	backupRoot: string,
) {
	await mkdir(destination, { recursive: true });
	for (const entry of await readdir(source, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === ".DS_Store") continue;
		const from = join(source, entry.name);
		const to = join(destination, entry.name);
		if (entry.isDirectory()) await copyTree(from, to, backupRoot);
		else if (entry.isFile()) await save(to, await readFile(from), backupRoot);
	}
}

export function run(command: string, args: string[], env = process.env) {
	const result = spawnSync(command, args, { stdio: "inherit", env });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

export function hasCommand(command: string, os: OS) {
	return (
		spawnSync(
			os === "win32" ? "where.exe" : "sh",
			os === "win32"
				? [command]
				: ["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command],
			{ stdio: "ignore" },
		).status === 0
	);
}

export function assetSuffix(tool: "bat" | "micro", os: OS, arch: string) {
	const cpu = { x64: "x86_64", arm64: "aarch64", ia32: "i686", arm: "arm" }[
		arch
	];
	if (!cpu) throw new Error(`Unsupported architecture: ${arch}`);
	if (tool === "bat") {
		const target =
			os === "darwin"
				? "apple-darwin"
				: os === "win32"
					? "pc-windows-msvc"
					: arch === "arm"
						? "unknown-linux-musleabihf"
						: "unknown-linux-musl";
		return `-${cpu}-${target}.${os === "win32" ? "zip" : "tar.gz"}`;
	}
	const target =
		os === "darwin"
			? { x64: "osx", arm64: "macos-arm64" }[arch]
			: os === "win32"
				? { x64: "win64", arm64: "win-arm64", ia32: "win32" }[arch]
				: {
						x64: "linux64-static",
						arm64: "linux-arm64",
						ia32: "linux32",
						arm: "linux-arm",
					}[arch];
	if (!target) throw new Error(`No micro binary for ${os}/${arch}`);
	return `-${target}.${os === "win32" ? "zip" : "tar.gz"}`;
}

async function download(url: string) {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(120_000),
		headers: { "User-Agent": "oh-ry-zsh-setup" },
	});
	if (!response.ok)
		throw new Error(`Download failed: ${response.status} ${url}`);
	return response;
}

async function findBinary(
	directory: string,
	name: string,
): Promise<string | undefined> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isFile() && entry.name === name) return path;
		if (entry.isDirectory()) {
			const found = await findBinary(path, name);
			if (found) return found;
		}
	}
}

export async function installBinary(
	tool: "bat" | "micro",
	os: OS,
	arch: string,
	bin: string,
	temp: string,
	backupRoot: string,
) {
	const suffix = assetSuffix(tool, os, arch);
	const repo = tool === "bat" ? "sharkdp/bat" : "zyedidia/micro";
	const release = (await (
		await download(`https://api.github.com/repos/${repo}/releases/latest`)
	).json()) as {
		assets: { name: string; browser_download_url: string; digest?: string }[];
	};
	const asset = release.assets.find((asset) => asset.name.endsWith(suffix));
	if (!asset) throw new Error(`No ${tool} release binary for ${os}/${arch}`);
	console.log(`Installing ${asset.name}`);
	const data = Buffer.from(
		await (await download(asset.browser_download_url)).arrayBuffer(),
	);
	if (
		asset.digest?.startsWith("sha256:") &&
		asset.digest !== `sha256:${createHash("sha256").update(data).digest("hex")}`
	)
		throw new Error(`Checksum mismatch for ${asset.name}`);
	const archive = join(temp, asset.name);
	await writeFile(archive, data);
	const extracted = join(temp, tool);
	await mkdir(extracted);
	if (os === "win32") {
		run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:OH_RY_ARCHIVE -DestinationPath $env:OH_RY_EXTRACT",
			],
			{ ...process.env, OH_RY_ARCHIVE: archive, OH_RY_EXTRACT: extracted },
		);
	} else run("tar", ["-xzf", archive, "-C", extracted]);
	const name = `${tool}${os === "win32" ? ".exe" : ""}`;
	const binary = await findBinary(extracted, name);
	if (!binary) throw new Error(`${name} missing from ${asset.name}`);
	const target = join(bin, name);
	await save(target, await readFile(binary), backupRoot);
	if (os !== "win32") await chmod(target, 0o755);
	run(target, ["--version"]);
	if (tool === "bat") {
		const alias = join(bin, `batcat${os === "win32" ? ".exe" : ""}`);
		await save(alias, await readFile(binary), backupRoot);
		if (os !== "win32") await chmod(alias, 0o755);
	}
	return target;
}
