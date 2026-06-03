import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Extract a PNG image from the macOS clipboard and save it to a temp file.
 * Returns the temp file path on success, null if no image is present or on
 * non-macOS platforms.
 */
export async function extractClipboardImage(): Promise<string | null> {
  if (process.platform !== "darwin") return null;

  return new Promise((resolve) => {
    // AppleScript: try to coerce clipboard to PNG; write raw bytes to stdout.
    const script = `
      try
        set imgData to the clipboard as «class PNGf»
        return imgData
      on error
        return ""
      end try
    `;
    execFile(
      "osascript",
      ["-e", script],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
      async (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const raw = stdout.toString("latin1").trim();
        if (!raw || raw === '""') {
          resolve(null);
          return;
        }
        // AppleScript may return raw bytes (starts with PNG magic ‰PNG) or a
        // hex-encoded «data PNGf…» string depending on macOS version.
        const header = stdout.subarray(0, 4);
        if (header[0] === 0x89 && header[1] === 0x50) {
          // Raw PNG bytes in stdout buffer.
          try {
            const tmpPath = join(tmpdir(), `inklit-img-${Date.now()}.png`);
            await writeFile(tmpPath, stdout);
            resolve(tmpPath);
          } catch {
            resolve(null);
          }
          return;
        }
        // Hex-encoded «data PNGf89504e47...» format.
        const hexMatch = /«data PNGf([0-9a-fA-F]+)»/.exec(raw);
        if (!hexMatch || !hexMatch[1]) {
          resolve(null);
          return;
        }
        try {
          const imgBuf = Buffer.from(hexMatch[1], "hex");
          const tmpPath = join(tmpdir(), `inklit-img-${Date.now()}.png`);
          await writeFile(tmpPath, imgBuf);
          resolve(tmpPath);
        } catch {
          resolve(null);
        }
      }
    );
  });
}
