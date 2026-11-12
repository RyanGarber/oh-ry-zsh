import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	assetSuffix,
	copyTree,
	exists,
	managedBlock,
	OMZ_PLUGINS,
	paths,
	save,
	shellQuote,
} from "./setup-lib.ts";

test("startup blocks preserve surrounding config and rerun without duplication", () => {
	const original = "# keep me\nexport CUSTOM=yes\n";
	const first = managedBlock(original, "export OH_RY_ZSH_ALIAS=1");
	assert.equal(managedBlock(first, "export OH_RY_ZSH_ALIAS=1"), first);
	const changed = managedBlock(
		`${first}# trailing\n`,
		"export OH_RY_ZSH_ALIAS=0",
	);
	assert.ok(changed.startsWith(original));
	assert.ok(changed.endsWith("# trailing\n"));
	assert.equal(changed.match(/# >>> oh-ry-zsh >>>/g)?.length, 1);
	assert.ok(changed.includes("OH_RY_ZSH_ALIAS=0"));
	assert.throws(() => managedBlock("# >>> oh-ry-zsh >>>", "new"), /Malformed/);
});

test("platform paths honor Windows AppData overrides and requested Unix locations", () => {
	assert.deepEqual(paths("linux", "/home/me", {}), {
		bin: "/home/me/.local/bin",
		bat: "/home/me/.local/config/bat",
		micro: "/home/me/.local/config/micro",
	});
	const windows = paths("win32", "C:\\Users\\Me", {
		APPDATA: "D:\\Roaming",
		LOCALAPPDATA: "D:\\Local",
	});
	assert.equal(windows.bin, "D:\\Local\\Programs\\oh-ry-zsh\\bin");
	assert.equal(windows.bat, "D:\\Roaming\\bat");
	assert.equal(windows.micro, "C:\\Users\\Me\\.local\\config\\micro");
});

test("release selection covers supported CPUs and operating systems", () => {
	assert.equal(
		assetSuffix("bat", "linux", "arm64"),
		"-aarch64-unknown-linux-musl.tar.gz",
	);
	assert.equal(
		assetSuffix("bat", "win32", "x64"),
		"-x86_64-pc-windows-msvc.zip",
	);
	assert.equal(assetSuffix("micro", "darwin", "arm64"), "-macos-arm64.tar.gz");
	assert.equal(assetSuffix("micro", "darwin", "x64"), "-osx.tar.gz");
	assert.equal(assetSuffix("micro", "linux", "x64"), "-linux64-static.tar.gz");
	assert.equal(assetSuffix("micro", "win32", "arm64"), "-win-arm64.zip");
	assert.throws(() => assetSuffix("micro", "darwin", "arm"), /No micro binary/);
	assert.throws(() => assetSuffix("bat", "linux", "riscv64"), /Unsupported/);
});

test("config copies back up changed files, preserve extras, skip git metadata, and are repeatable", async () => {
	const dir = await mkdtemp(join(tmpdir(), "oh-ry-test-"));
	try {
		const src = join(dir, "source");
		const dest = join(dir, "dest");
		const backups = join(dir, "backups");
		await mkdir(src);
		await mkdir(dest);
		await writeFile(join(src, "config"), "new");
		await writeFile(join(src, ".git"), "private metadata");
		await writeFile(join(dest, "config"), "old");
		await writeFile(join(dest, "extra"), "preserve");
		await copyTree(src, dest, backups);
		assert.equal(await readFile(join(dest, "config"), "utf8"), "new");
		assert.equal(await readFile(join(dest, "extra"), "utf8"), "preserve");
		assert.deepEqual((await readdir(dest)).sort(), ["config", "extra"]);
		const entries = await readdir(backups);
		assert.equal(
			await readFile(join(backups, entries[0], "config"), "utf8"),
			"old",
		);
		await copyTree(src, dest, backups);
		assert.deepEqual(await readdir(backups), entries);
		assert.equal(
			await readFile(join(backups, entries[0], "config"), "utf8"),
			"old",
		);
		if (process.platform !== "win32") {
			await symlink(join(dest, "extra"), join(dest, "link"));
			await assert.rejects(save(join(dest, "link"), "bad", backups), /symlink/);
			assert.equal(await readFile(join(dest, "extra"), "utf8"), "preserve");
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Bash and Zsh source shared config quietly, preserve user aliases, and quote paths safely", () => {
	if (process.platform === "win32") return;
	for (const shell of ["bash", "zsh"]) {
		const probe = spawnSync(shell, ["--version"]);
		if (probe.error) continue;
		const script = `alias cat='custom-cat'; export OH_RY_ZSH_ALIAS=0 OH_RY_ZSH_OMZ=0; source assets/.oh-ry-zsh; alias cat; printf '%s' ${shellQuote("a'b $(echo unsafe) space")}`;
		const result = spawnSync(shell, [shell === "zsh" ? "-fc" : "-c", script], {
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.ok(result.stdout.includes("custom-cat"));
		assert.ok(result.stdout.endsWith("a'b $(echo unsafe) space"));
	}
});

test("bundled plugins install under names matching Oh My Zsh entrypoints", async () => {
	for (const plugin of OMZ_PLUGINS) {
		assert.ok(
			await exists(
				join(
					import.meta.dirname,
					"..",
					"assets",
					".oh-my-zsh",
					"custom",
					"plugins",
					plugin.source,
					`${plugin.name}.plugin.zsh`,
				),
			),
			plugin.name,
		);
	}
	const config = await readFile(
		join(import.meta.dirname, "..", "assets", ".oh-ry-zsh"),
		"utf8",
	);
	for (const plugin of OMZ_PLUGINS) assert.ok(config.includes(plugin.name));
});
