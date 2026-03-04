const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

type JsonObject = Record<string, unknown>;

export type FeishuAuthInput = {
  appId: string;
  appSecret: string;
  tenantAccessToken?: string;
};

export type FeishuDocIds = {
  docToken: string;
  url: string;
};

function sanitizeJsonText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/^\)\]\}',?\s*/, "")
    .replace(/^for\s*\(;;\);\s*/i, "")
    .trim();
}

const MAX_RATE_LIMIT_RETRIES = 6;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15000;
const MIN_REQUEST_INTERVAL_MS = 350;

let lastRequestTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

function parseRetryAfterMs(response: Response): number | null {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const byHeader = parseRetryAfterMs(response);
  if (byHeader !== null) {
    return Math.min(MAX_RETRY_DELAY_MS, byHeader);
  }

  const jitter = Math.floor(Math.random() * 300);
  const backoff = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  return Math.min(MAX_RETRY_DELAY_MS, backoff + jitter);
}

function isRateLimited(response: Response, body: JsonObject | null): boolean {
  if (response.status === 429) return true;
  if (response.status === 400 && body?.code === 99991400) return true;
  return false;
}

async function fetchWithRateLimitRetry(url: string, init: RequestInit, action: string): Promise<{ response: Response; body: JsonObject }> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    await throttle();

    const response = await fetch(url, init);
    const raw = await response.text();
    const cleaned = sanitizeJsonText(raw);

    let body: JsonObject | null = null;
    if (cleaned) {
      try {
        body = JSON.parse(cleaned) as JsonObject;
      } catch {
        // non-JSON response, will be handled below
      }
    }

    if (!isRateLimited(response, body)) {
      if (!cleaned) {
        throw new Error(`${action} failed: empty response (HTTP ${response.status})`);
      }
      if (!body) {
        throw new Error(`${action} 返回了非 JSON 响应（HTTP ${response.status}）：${raw.slice(0, 180)}`);
      }
      return { response, body };
    }

    if (attempt === MAX_RATE_LIMIT_RETRIES) {
      throw new Error(`${action} failed: 请求过于频繁，已重试 ${MAX_RATE_LIMIT_RETRIES} 次仍被限流，请稍后重试。`);
    }

    await sleep(getRetryDelayMs(response, attempt));
  }

  throw new Error(`${action} failed: unexpected retry state`);
}

function ensureOk<T extends { code?: number; msg?: string }>(res: T, action: string): T {
  if (res.code && res.code !== 0) {
    if ((res.msg ?? "").toLowerCase().includes("forbidden")) {
      throw new Error(`${action} failed: forbidden（应用权限或文档授权不足）`);
    }
    throw new Error(`${action} failed: ${res.msg ?? "unknown error"}`);
  }
  return res;
}

export async function getTenantAccessToken(input: FeishuAuthInput): Promise<string> {
  if (input.tenantAccessToken?.trim()) {
    return input.tenantAccessToken.trim();
  }

  if (!input.appId || !input.appSecret) {
    throw new Error("Please provide App ID and App Secret, or an existing tenant_access_token.");
  }

  const { body } = await fetchWithRateLimitRetry(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: input.appId,
      app_secret: input.appSecret,
    }),
  }, "Get tenant_access_token");

  const data = ensureOk(body, "Get tenant_access_token");
  const token = data.tenant_access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("No tenant_access_token returned from Feishu.");
  }
  return token;
}

type ParsedFeishuTarget =
  | { kind: "docx"; token: string; url: string }
  | { kind: "wiki"; token: string; url: string };

function parseFeishuTarget(docUrl: string): ParsedFeishuTarget {
  const trimmed = docUrl.trim();
  if (!trimmed) {
    throw new Error("请填写飞书文档地址");
  }

  let pathname = "";
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    throw new Error("飞书文档地址格式不正确");
  }

  const docxMatch = pathname.match(/\/docx\/([a-zA-Z0-9]+)/);
  if (docxMatch) {
    return {
      kind: "docx",
      token: docxMatch[1],
      url: trimmed,
    };
  }

  const wikiMatch = pathname.match(/\/wiki\/([a-zA-Z0-9]+)/);
  if (wikiMatch) {
    return {
      kind: "wiki",
      token: wikiMatch[1],
      url: trimmed,
    };
  }

  throw new Error("无效的飞书地址，需为 /docx/ 或 /wiki/ 链接");
}

export async function resolveDocToken(docUrl: string, token: string): Promise<FeishuDocIds> {
  const target = parseFeishuTarget(docUrl);

  if (target.kind === "docx") {
    return {
      docToken: target.token,
      url: target.url,
    };
  }

  const { body } = await fetchWithRateLimitRetry(
    `${FEISHU_API_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(target.token)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    "Get wiki node info",
  );

  const data = ensureOk(body, "Get wiki node info");
  const node = (data?.data as { node?: { obj_token?: unknown; obj_type?: unknown } })?.node;
  const objToken = typeof node?.obj_token === "string" ? node.obj_token.trim() : "";
  const objType = typeof node?.obj_type === "string" ? node.obj_type : "";

  if (!objToken) {
    throw new Error("Wiki 节点未返回 obj_token，无法解析文档 ID");
  }

  if (objType && objType !== "docx") {
    throw new Error(`Wiki 节点类型为 ${objType}，当前仅支持 docx 文档同步`);
  }

  return {
    docToken: objToken,
    url: target.url,
  };
}

export async function listRootBlocks(
  docToken: string,
  token: string,
): Promise<Array<{ block_id: string; block_type?: number; parent_id?: string }>> {
  const { body } = await fetchWithRateLimitRetry(
    `${FEISHU_API_BASE}/docx/v1/documents/${docToken}/blocks/${docToken}/children?page_size=500`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    "List document blocks",
  );

  const data = ensureOk(body, "List document blocks");
  return (data?.data as { items?: Array<{ block_id: string; block_type?: number; parent_id?: string }> })?.items ?? [];
}

export async function deleteBlocksByIndexRange(docToken: string, token: string, startIndex: number, endIndex: number): Promise<void> {
  if (endIndex <= startIndex) {
    return;
  }

  const { body } = await fetchWithRateLimitRetry(
    `${FEISHU_API_BASE}/docx/v1/documents/${docToken}/blocks/${docToken}/children/batch_delete`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        start_index: startIndex,
        end_index: endIndex,
      }),
    },
    "Delete document blocks",
  );

  ensureOk(body, "Delete document blocks");
}

type FeishuBlock = Record<string, unknown>;

function textElement(content: string, style?: Record<string, unknown>): Record<string, unknown> {
  const el: Record<string, unknown> = { text_run: { content } };
  if (style) {
    (el.text_run as Record<string, unknown>).text_element_style = style;
  }
  return el;
}

function textBlock(content: string, style?: Record<string, unknown>): FeishuBlock {
  return { block_type: 2, text: { elements: [textElement(content, style)], style: {} } };
}

function headingBlock(level: number, content: string): FeishuBlock {
  const key = `heading${level}`;
  return { block_type: 2 + level, [key]: { elements: [textElement(content)], style: {} } };
}

function dividerBlock(): FeishuBlock {
  return { block_type: 22, divider: {} };
}

function bulletBlock(content: string): FeishuBlock {
  return { block_type: 12, bullet: { elements: [textElement(content)], style: {} } };
}

function quoteBlock(content: string): FeishuBlock {
  return { block_type: 15, quote: { elements: [textElement(content)], style: {} } };
}

function markdownToBlocks(markdown: string): FeishuBlock[] {
  const blocks: FeishuBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trim() === "---") {
      blocks.push(dividerBlock());
      i++;
      continue;
    }

    const h1Match = line.match(/^# (.+)/);
    if (h1Match) {
      blocks.push(headingBlock(1, h1Match[1]));
      i++;
      continue;
    }

    const h2Match = line.match(/^## (.+)/);
    if (h2Match) {
      blocks.push(headingBlock(2, h2Match[1]));
      i++;
      continue;
    }

    const h3Match = line.match(/^### (.+)/);
    if (h3Match) {
      blocks.push(headingBlock(3, h3Match[1]));
      i++;
      continue;
    }

    const bulletMatch = line.match(/^- (.+)/);
    if (bulletMatch) {
      blocks.push(bulletBlock(bulletMatch[1]));
      i++;
      continue;
    }

    const quoteMatch = line.match(/^> (.+)/);
    if (quoteMatch) {
      const quoteLines = [quoteMatch[1]];
      i++;
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push(quoteBlock(quoteLines.join("\n")));
      continue;
    }

    if (line.trim()) {
      blocks.push(textBlock(line));
    }
    i++;
  }

  return blocks;
}

const BATCH_SIZE = 50;

async function appendBlocks(docToken: string, token: string, children: FeishuBlock[]): Promise<void> {
  for (let start = 0; start < children.length; start += BATCH_SIZE) {
    const batch = children.slice(start, start + BATCH_SIZE);

    const { body } = await fetchWithRateLimitRetry(
      `${FEISHU_API_BASE}/docx/v1/documents/${docToken}/blocks/${docToken}/children`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ children: batch }),
      },
      "Create document blocks",
    );

    ensureOk(body, "Create document blocks");
  }
}

async function clearRootBlocks(docToken: string, token: string): Promise<void> {
  const MAX_ROUNDS = 200;

  for (let i = 0; i < MAX_ROUNDS; i += 1) {
    const items = await listRootBlocks(docToken, token);
    if (items.length === 0) {
      return;
    }

    await deleteBlocksByIndexRange(docToken, token, 0, items.length);
  }

  throw new Error("清空飞书文档失败：删除轮次过多，请重试。若持续失败，请检查文档是否在被其他人同时编辑。");
}

export async function overwriteDocWithMarkdown(docToken: string, token: string, markdown: string): Promise<void> {
  await clearRootBlocks(docToken, token);

  const blocks = markdownToBlocks(markdown);
  await appendBlocks(docToken, token, blocks);
}
