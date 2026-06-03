import { execFile, execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * AppleScript that coerces the clipboard to PNG and writes it to `path`,
 * returning "ok" on success or "" if the clipboard holds no image. Writing the
 * file from AppleScript (rather than piping «class PNGf» back through stdout)
 * sidesteps the brittle UTF-8 guillemet/hex decoding that broke earlier.
 */
function writeScript(path: string): string {
  const quoted = JSON.stringify(path); // safe AppleScript string literal
  return `
    try
      set pngData to (the clipboard as «class PNGf»)
      set fileRef to open for access POSIX file ${quoted} with write permission
      write pngData to fileRef
      close access fileRef
      return "ok"
    on error
      try
        close access POSIX file ${quoted}
      end try
      return ""
    end try
  `;
}

/**
 * Extract a PNG image from the macOS clipboard and save it to a temp file.
 * Returns the temp file path on success, null if no image is present or on
 * non-macOS platforms. Async — used for the proactive check on mode entry.
 */
export async function extractClipboardImage(): Promise<string | null> {
  if (process.platform !== "darwin") return null;

  const tmpPath = join(tmpdir(), `inklit-img-${Date.now()}.png`);

  return new Promise((resolve) => {
    execFile("osascript", ["-e", writeScript(tmpPath)], async (err, stdout) => {
      if (err || stdout.toString().trim() !== "ok") {
        await unlink(tmpPath).catch(() => {});
        resolve(null);
        return;
      }
      resolve(tmpPath);
    });
  });
}

/**
 * Synchronous variant of {@link extractClipboardImage}. Blocks ~100ms on
 * osascript. Used for the Ctrl+V paste path so the resulting dispatch happens
 * inside Ink's batched input handler — an async dispatch from a promise
 * callback renders outside Ink's reconciliation cycle and corrupts the
 * terminal output.
 */
export function extractClipboardImageSync(): string | null {
  if (process.platform !== "darwin") return null;

  const tmpPath = join(tmpdir(), `inklit-img-${Date.now()}.png`);
  try {
    const out = execFileSync("osascript", ["-e", writeScript(tmpPath)], {
      encoding: "utf8",
    });
    if (out.trim() === "ok") return tmpPath;
  } catch {
    // fall through to cleanup
  }
  try {
    unlinkSync(tmpPath);
  } catch {
    /* nothing to clean up */
  }
  return null;
}
