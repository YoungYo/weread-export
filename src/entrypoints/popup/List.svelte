<script lang="ts">
  import { onMount } from "svelte";
  import { downloadMarkdownFile } from "./export";
  import { getTenantAccessToken, overwriteDocWithMarkdown, resolveDocToken } from "./feishu";
  import { loadConfig, saveConfig } from "./storage";
  import type { BookBrief, FeishuConfig, SyncState } from "./types";
  import { fetchBookMarkdown, fetchNotebookBooks } from "./weread";

  export let userVid = "";

  let books: BookBrief[] = [];
  let selectedBookIds = new Set<string>();
  let loadingBooks = true;
  let configLoading = true;

  let config: FeishuConfig = {
    docUrl: "",
    appId: "",
    appSecret: "",
    tenantAccessToken: "",
  };

  let syncState: SyncState = {
    status: "idle",
    message: "先试试本地 Markdown 导出；飞书同步仍为覆盖原文档模式。",
  };

  let bookQuery = "";

  $: normalizedBookQuery = bookQuery.trim().toLowerCase();
  $: filteredBooks = normalizedBookQuery
    ? books.filter((book) => `${book.title ?? ""} ${book.author ?? ""}`.toLowerCase().includes(normalizedBookQuery))
    : books;
  $: allSelected = filteredBooks.length > 0 && filteredBooks.every((book) => selectedBookIds.has(book.bookId));
  $: selectedCount = selectedBookIds.size;

  async function init() {
    try {
      const [savedConfig, fetchedBooks] = await Promise.all([loadConfig(), fetchNotebookBooks()]);
      config = savedConfig;
      books = fetchedBooks;
      selectedBookIds = new Set(fetchedBooks.map((book) => book.bookId));
    } catch (error) {
      console.error(error);
      syncState = {
        status: "error",
        message: "拉取微信读书书籍失败，请确认已登录微信读书网页版。",
      };
    } finally {
      loadingBooks = false;
      configLoading = false;
    }
  }

  function toggleBook(bookId: string, checked: boolean) {
    const next = new Set(selectedBookIds);
    if (checked) {
      next.add(bookId);
    } else {
      next.delete(bookId);
    }
    selectedBookIds = next;
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      selectedBookIds = new Set(filteredBooks.map((book) => book.bookId));
      return;
    }

    const next = new Set(selectedBookIds);
    filteredBooks.forEach((book) => next.delete(book.bookId));
    selectedBookIds = next;
  }

  async function persistConfig() {
    await saveConfig(config);
  }

  function ensureBooksSelected() {
    if (selectedBookIds.size === 0) {
      throw new Error("请至少选择一本书");
    }
  }

  function ensureFeishuInputValid() {
    if (!config.docUrl.trim()) {
      throw new Error("请填写飞书文档地址");
    }

    if (!config.tenantAccessToken.trim() && (!config.appId.trim() || !config.appSecret.trim())) {
      throw new Error("请填写 AppId + AppSecret，或直接填写 tenant_access_token");
    }
  }

  function getSelectedBooks(): BookBrief[] {
    ensureBooksSelected();
    return books.filter((book) => selectedBookIds.has(book.bookId));
  }

  async function exportToMarkdown() {
    try {
      const ordered = getSelectedBooks();
      syncState = {
        status: "running",
        message: `正在导出 ${ordered.length} 本书为 Markdown...`,
      };

      for (let i = 0; i < ordered.length; i += 1) {
        const book = ordered[i];
        syncState = {
          status: "running",
          message: `正在导出（${i + 1}/${ordered.length}）：${book.title}`,
        };

        const markdown = await fetchBookMarkdown(book.bookId, userVid);
        await downloadMarkdownFile(book.title, markdown);
      }

      syncState = {
        status: "done",
        message: `导出完成，已生成 ${ordered.length} 个 Markdown 文件。`,
      };
    } catch (error) {
      console.error(error);
      syncState = {
        status: "error",
        message: error instanceof Error ? error.message : "导出失败，请重试。",
      };
    }
  }

  async function syncToFeishu() {
    try {
      const ordered = getSelectedBooks();
      ensureFeishuInputValid();

      syncState = {
        status: "running",
        message: `正在同步 ${ordered.length} 本书到飞书（覆盖原文档）...`,
      };

      await persistConfig();

      const token = await getTenantAccessToken({
        appId: config.appId.trim(),
        appSecret: config.appSecret.trim(),
        tenantAccessToken: config.tenantAccessToken.trim(),
      });
      const { docToken } = await resolveDocToken(config.docUrl, token);

      const markdownPieces: string[] = [];

      for (let i = 0; i < ordered.length; i += 1) {
        const book = ordered[i];
        syncState = {
          status: "running",
          message: `正在处理（${i + 1}/${ordered.length}）：${book.title}`,
        };

        const markdown = await fetchBookMarkdown(book.bookId, userVid);
        markdownPieces.push(markdown);
      }

      const merged = `# 微信读书笔记同步\n\n同步时间：${new Date().toLocaleString()}\n\n---\n\n${markdownPieces.join("\n\n")}`;
      await overwriteDocWithMarkdown(docToken, token, merged);

      syncState = {
        status: "done",
        message: `同步完成，已覆盖写入 ${ordered.length} 本书到飞书文档。`,
      };
    } catch (error) {
      console.error(error);
      const msg = error instanceof Error ? error.message : "同步失败，请重试。";
      syncState = {
        status: "error",
        message: msg.includes("Unexpected non-whitespace character after JSON")
          ? "接口返回格式异常（可能是 token 失效、租户不匹配或命中网关拦截），请重新获取 token 后重试。"
          : msg,
      };
    }
  }

  onMount(() => {
    init();
  });
</script>

<div class="topbar">
  <div class="title-wrap">
    <div>
      <div class="title">微信读书笔记导出</div>
      <div class="subtitle">先导出本地 Markdown；飞书同步作为高级用法保留。</div>
    </div>
    <a class="help-link" href="https://my.feishu.cn/docx/FmaLd3ugyobkZux7jbUc6qQPn0e" target="_blank" rel="noreferrer">
      帮助文档
    </a>
  </div>

  <div class="action-group">
    <button class="export-btn" on:click={exportToMarkdown} disabled={loadingBooks || syncState.status === "running"}>
      导出 Markdown（本地）
    </button>
    <button class="sync-btn" on:click={syncToFeishu} disabled={loadingBooks || configLoading || syncState.status === "running"}>
      同步到飞书（覆盖原文档）
    </button>
  </div>
</div>

<div class="hero-tip">
  <strong>推荐先试本地导出：</strong>
  无需飞书配置，适合先验证导出效果；飞书同步会覆盖目标文档原有内容。
</div>

<div class="layout">
  <section class="panel">
    <h3>飞书配置（仅飞书同步需要）</h3>
    <label>
      文档地址
      <input bind:value={config.docUrl} placeholder="https://xxx.feishu.cn/docx/xxxx 或 /wiki/xxxx" on:change={persistConfig} />
    </label>
    <label>
      App ID
      <input bind:value={config.appId} placeholder="cli_xxx" on:change={persistConfig} />
    </label>
    <label>
      App Secret
      <input bind:value={config.appSecret} placeholder="可选：与 App ID 一起使用" type="password" on:change={persistConfig} />
    </label>
    <label>
      tenant_access_token
      <input bind:value={config.tenantAccessToken} placeholder="可直接粘贴，优先使用" type="password" on:change={persistConfig} />
    </label>
    <p class="hint">可二选一：`AppId + AppSecret` 或 `tenant_access_token`。</p>

    <div class="warning-box">
      <div class="warning-title">飞书同步风险提示</div>
      <ul>
        <li>当前是<strong>覆盖原文档</strong>模式，不是增量同步。</li>
        <li>建议先用测试文档验证排版、权限和 token。</li>
        <li>同步中断时，目标文档可能处于部分写入状态。</li>
      </ul>
    </div>
  </section>

  <section class="panel">
    <div class="book-header">
      <h3>书籍选择</h3>
      <label class="select-all">
        <input type="checkbox" checked={allSelected} on:change={(e) => toggleAll(e.currentTarget.checked)} />
        一键全选
      </label>
    </div>

    {#if !loadingBooks && books.length > 0}
      <input class="book-search" bind:value={bookQuery} placeholder="搜索书名或作者（模糊匹配）" />
      <div class="selected-tip">当前已选择 {selectedCount} 本书</div>
    {/if}

    {#if loadingBooks}
      <div class="status">正在加载书籍...</div>
    {:else if books.length === 0}
      <div class="status">未找到可同步书籍，请确认微信读书账号有笔记。</div>
    {:else if filteredBooks.length === 0}
      <div class="status">没有匹配的书籍，请调整搜索关键词。</div>
    {:else}
      <div class="books">
        {#each filteredBooks as book (book.bookId)}
          <label class="book-item">
            <input
              type="checkbox"
              checked={selectedBookIds.has(book.bookId)}
              on:change={(e) => toggleBook(book.bookId, e.currentTarget.checked)}
            />
            <img src={(book.cover ?? "").replace("s_", "t6_")} alt={book.title} />
            <div class="book-meta">
              <div class="book-title">{book.title}</div>
              <div class="book-author">{book.author ?? "未知作者"}</div>
            </div>
          </label>
        {/each}
      </div>
    {/if}
  </section>
</div>

<div class={`status-bar ${syncState.status}`}>{syncState.message}</div>

<div class="support-section">
  <div class="support-title">支持一下</div>
  <p>如果这个插件帮到了你，欢迎扫码赞赏~</p>
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=微信收款码链接" alt="赞赏码" class="qr-code" />
  <p class="support-hint">（替换成你的收款码链接）</p>
</div>

<style>
  .topbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .title-wrap {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 0;
  }

  .title {
    font-size: 18px;
    font-weight: 700;
    color: #12213a;
  }

  .subtitle {
    margin-top: 4px;
    font-size: 12px;
    color: #64748b;
  }

  .help-link {
    font-size: 12px;
    color: #2563eb;
    text-decoration: none;
    white-space: nowrap;
    margin-top: 2px;
  }

  .help-link:hover {
    text-decoration: underline;
  }

  .action-group {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .export-btn,
  .sync-btn {
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 600;
    cursor: pointer;
    margin: 0;
  }

  .export-btn {
    background: linear-gradient(120deg, #0f766e, #14b8a6);
  }

  .sync-btn {
    background: linear-gradient(120deg, #b45309, #ea580c);
  }

  .export-btn:disabled,
  .sync-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hero-tip {
    margin-bottom: 14px;
    border-radius: 12px;
    padding: 12px 14px;
    background: #ecfeff;
    border: 1px solid #a5f3fc;
    color: #155e75;
    font-size: 13px;
  }

  .layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 14px;
  }

  .panel {
    background: #fff;
    border: 1px solid #dce3f0;
    border-radius: 12px;
    padding: 12px;
  }

  h3 {
    margin: 2px 0 10px;
    font-size: 15px;
    color: #1f3252;
  }

  label {
    display: block;
    font-size: 12px;
    color: #425675;
    margin-bottom: 10px;
  }

  input {
    width: 100%;
    margin-top: 4px;
    margin-bottom: 0;
    border: 1px solid #c9d5e7;
    border-radius: 8px;
    padding: 8px 10px;
  }

  .hint {
    margin: 8px 0 0;
    color: #6c7f9d;
    font-size: 12px;
  }

  .warning-box {
    margin-top: 12px;
    border-radius: 10px;
    border: 1px solid #fdba74;
    background: #fff7ed;
    padding: 10px 12px;
  }

  .warning-title {
    font-size: 13px;
    font-weight: 700;
    color: #9a3412;
    margin-bottom: 6px;
  }

  .warning-box ul {
    margin: 0;
    padding-left: 18px;
    color: #9a3412;
    font-size: 12px;
    line-height: 1.5;
  }

  .book-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }

  .book-search {
    width: 100%;
    margin: 0 0 8px;
  }

  .selected-tip {
    font-size: 12px;
    color: #475569;
    margin-bottom: 10px;
  }

  .select-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: #344865;
  }

  .select-all input {
    width: auto;
    margin: 0;
  }

  .books {
    max-height: 410px;
    overflow: auto;
    display: grid;
    gap: 10px;
    padding-right: 2px;
  }

  .book-item {
    display: grid;
    grid-template-columns: 20px 44px 1fr;
    align-items: center;
    gap: 8px;
    border: 1px solid #e2e8f5;
    border-radius: 10px;
    padding: 7px;
    margin-bottom: 0;
    background: #f9fbff;
  }

  .book-item input {
    width: 16px;
    height: 16px;
    margin: 0;
  }

  .book-item img {
    width: 44px;
    height: 60px;
    object-fit: cover;
    border-radius: 4px;
    background: #e9edf5;
  }

  .book-title {
    font-size: 13px;
    font-weight: 600;
    color: #1f2d45;
    margin-bottom: 4px;
    line-height: 1.2;
  }

  .book-author {
    font-size: 12px;
    color: #64748b;
  }

  .status {
    color: #64748b;
    font-size: 13px;
  }

  .status-bar {
    margin-top: 12px;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
    border: 1px solid #cdd9ee;
    background: #f4f7ff;
    color: #2e3d5e;
  }

  .status-bar.running {
    background: #fff7ed;
    border-color: #fdba74;
    color: #9a4d0b;
  }

  .status-bar.done {
    background: #ecfdf5;
    border-color: #86efac;
    color: #166534;
  }

  .status-bar.error {
    background: #fef2f2;
    border-color: #fca5a5;
    color: #991b1b;
  }

  .support-section {
    margin-top: 16px;
    text-align: center;
    padding: 12px;
    background: #fff9e6;
    border: 1px solid #fde68a;
    border-radius: 10px;
  }

  .support-title {
    font-size: 14px;
    font-weight: 600;
    color: #92400e;
    margin-bottom: 6px;
  }

  .support-section p {
    margin: 0 0 8px;
    font-size: 12px;
    color: #a16207;
  }

  .qr-code {
    width: 120px;
    height: 120px;
    border-radius: 8px;
    margin: 8px 0;
  }

  .support-hint {
    font-size: 11px !important;
    color: #a16207 !important;
    opacity: 0.7;
  }

  @media (max-width: 900px) {
    .topbar {
      flex-direction: column;
    }

    .action-group {
      width: 100%;
      justify-content: stretch;
    }

    .export-btn,
    .sync-btn {
      flex: 1;
    }

    .layout {
      grid-template-columns: 1fr;
    }

    .books {
      max-height: 320px;
    }
  }
</style>
