import { defineConfig } from "wxt";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "微信读书同步飞书文档",
    description: "将微信读书笔记按选中书籍同步到飞书云文档（覆盖写入）",
    version: "0.1.0",
    homepage_url: "https://github.com/YoungYo/weread-to-feishu",
    host_permissions: ["https://weread.qq.com/*", "https://open.feishu.cn/*"],
    permissions: ["storage", "downloads"],
  },
  vite: () => ({
    plugins: [
      svelte({
        configFile: false,
        preprocess: [vitePreprocess()],
      }),
    ],
  }),
});
