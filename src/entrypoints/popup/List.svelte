<script lang="ts">
  import { onMount } from "svelte";
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
    message: "请先选择书籍并配置飞书参数。",
  };

  let bookQuery = "";

  $: normalizedBookQuery = bookQuery.trim().toLowerCase();
  $: filteredBooks = normalizedBookQuery
    ? books.filter((book) => `${book.title ?? ""} ${book.author ?? ""}`.toLowerCase().includes(normalizedBookQuery))
    : books;
  $: allSelected = filteredBooks.length > 0 && filteredBooks.every((book) => selectedBookIds.has(book.bookId));

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

  function ensureInputValid() {
    if (!config.docUrl.trim()) {
      throw new Error("请填写飞书文档地址");
    }

    if (!config.tenantAccessToken.trim() && (!config.appId.trim() || !config.appSecret.trim())) {
      throw new Error("请填写 AppId + AppSecret，或直接填写 tenant_access_token");
    }

    if (selectedBookIds.size === 0) {
      throw new Error("请至少选择一本书");
    }
  }

  async function syncToFeishu() {
    try {
      ensureInputValid();

      syncState = {
        status: "running",
        message: `正在同步 ${selectedBookIds.size} 本书...`,
      };

      await persistConfig();

      const token = await getTenantAccessToken({
        appId: config.appId.trim(),
        appSecret: config.appSecret.trim(),
        tenantAccessToken: config.tenantAccessToken.trim(),
      });
      const { docToken } = await resolveDocToken(config.docUrl, token);

      const ordered = books.filter((book) => selectedBookIds.has(book.bookId));
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
  <div class="title">微信读书 -> 飞书文档</div>
  <button class="sync-btn" on:click={syncToFeishu} disabled={loadingBooks || configLoading || syncState.status === "running"}>
    {#if syncState.status === "running"}
      同步中...
    {:else}
      开始同步（覆盖原文档）
    {/if}
  </button>
</div>

<div class="layout">
  <section class="panel">
    <h3>飞书配置</h3>
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

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  .title {
    font-size: 18px;
    font-weight: 700;
    color: #12213a;
  }

  .sync-btn {
    background: linear-gradient(120deg, #0d9488, #2563eb);
    color: #fff;
    border: none;
    border-radius: 10px;
    padding: 10px 14px;
    font-weight: 600;
    cursor: pointer;
    margin: 0;
  }

  .sync-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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

  .book-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }

  .book-search {
    width: 100%;
    margin: 0 0 10px;
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

  @media (max-width: 900px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .books {
      max-height: 320px;
    }
  }
</style>
