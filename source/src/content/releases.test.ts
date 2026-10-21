import { describe, expect, it } from "vitest";
import { releases } from "./releases";
import pkg from "../../package.json";
import tauri from "../../src-tauri/tauri.conf.json";
import cargo from "../../src-tauri/Cargo.toml?raw";
import nativeBuild from "../../scripts/build-native.sh?raw";
import diarizeBuild from "../../scripts/build-diarize.sh?raw";
import swiftPackage from "../../speaker-diarize/Package.swift?raw";
import swiftResolved from "../../speaker-diarize/Package.resolved?raw";
import ignores from "../../.gitignore?raw";

describe("HoneyVoice candidate metadata", () => {
  it("uses the complete native preparation lane for development and every bundle type", () => {
    for (const command of [tauri.build.beforeBuildCommand, tauri.build.beforeDevCommand]) {
      expect(command).toMatch(/^bash scripts\/build-native\.sh && pnpm (dev|build)$/);
    }
    for (const helper of ["sidecar", "macos-speech", "diarize", "metallib", "mcp"]) {
      expect(nativeBuild).toContain(`bash scripts/build-${helper}.sh`);
    }
    expect(nativeBuild).toContain("bundle.externalBin");
    expect(nativeBuild).toContain('codesign --verify --strict "$target"');
    expect(tauri.bundle.externalBin).toEqual(expect.arrayContaining(["binaries/audio-capture", "binaries/macos-speech", "binaries/speaker-diarize", "binaries/humla-mcp"]));
  });
  it("ships and enforces the accepted diarization dependency lock", () => {
    const pin = JSON.parse(swiftResolved).pins.find((entry: { identity: string }) => entry.identity === "fluidaudio");
    expect(swiftPackage).toContain(`exact: "${pin.state.version}"`);
    expect(pin.state.revision).toMatch(/^[a-f0-9]{40}$/);
    expect(diarizeBuild).toContain("swift build -c release --product speaker-diarize --force-resolved-versions");
    expect(ignores.split(/\r?\n/)).not.toContain("speaker-diarize/Package.resolved");
  });
  it("keeps frontend, native package and app bundle versions aligned", () => {
    const packageSection = cargo.split("[package]")[1].split(/^\[/m)[0];
    const version = packageSection.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(version).toBe(pkg.version);
    expect(tauri.version).toBe(pkg.version);
    expect(tauri.productName).toBe("HoneyVoice");
    expect(tauri.identifier).toBe("com.miraphant.voice-memory");
  });
  it("does not advertise macOS below the bundled diarization runtime minimum", () => {
    expect(swiftPackage).toContain("platforms: [.macOS(.v14)]");
    expect(tauri.bundle.macOS.minimumSystemVersion).toBe("14.0");
  });
  it("has complete product-specific release notes for the built version", () => {
    const current = releases.find((release) => release.product === "honeyvoice" && release.version === pkg.version);
    expect(current).toBeDefined();
    expect(current!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(current!.title.trim()).not.toBe("");
    expect(current!.summary.trim()).not.toBe("");
    expect(current!.paragraphs.length).toBeGreaterThan(0);
    expect(current!.paragraphs.every((text) => text.trim().length > 0)).toBe(true);
    expect(current!.highlights.length).toBeGreaterThan(0);
    expect(releases.filter((release) => release.product === "honeyvoice" && release.version === pkg.version)).toHaveLength(1);
  });
});
