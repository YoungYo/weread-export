function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "微信读书笔记";
}

function triggerAnchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadViaBrowserApi(blob: Blob, filename: string): Promise<boolean> {
  const api = typeof browser !== "undefined" ? browser.downloads : typeof chrome !== "undefined" ? chrome.downloads : null;
  if (!api?.download) {
    return false;
  }

  const url = URL.createObjectURL(blob);

  try {
    await api.download({
      url,
      filename: `weread-notes/${filename}`,
      saveAs: false,
      conflictAction: "uniquify",
    });
    return true;
  } catch {
    return false;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export async function downloadMarkdownFile(bookTitle: string, markdown: string): Promise<void> {
  const filename = `${sanitizeFileName(bookTitle)}.md`;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });

  const downloaded = await downloadViaBrowserApi(blob, filename);
  if (!downloaded) {
    triggerAnchorDownload(blob, filename);
  }
}
