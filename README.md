<h1 align="center">WeRead to Feishu</h1>
<div align="center">
将微信读书笔记导出为本地 Markdown，并支持同步到飞书云文档（覆盖写入）
</div>

## 当前定位

这是一个 **微信读书笔记导出工具**，当前提供两种能力：

1. **导出 Markdown（本地）** —— 推荐先试，无需飞书配置
2. **同步到飞书文档** —— 高级用法，当前为覆盖原文档模式

## 功能

- [x] 自动读取微信读书书架中有笔记的书籍
- [x] 支持书籍多选
- [x] 支持一键全选
- [x] 支持按书名 / 作者模糊搜索
- [x] 支持导出选中书籍为本地 Markdown 文件
- [x] 支持填写飞书文档地址
- [x] 支持两种飞书鉴权方式：
  - AppId + AppSecret（自动换取 tenant_access_token）
  - 直接填写 tenant_access_token
- [x] 支持将微信读书划线 / 评论 / 阅读进度汇总为 Markdown 后写入飞书 Docx
- [x] 支持解析飞书 Wiki 链接并转换为 Docx 写入
- [x] 当前飞书同步行为为**覆盖目标文档原有内容**

## 技术方案（对应飞书接口）

插件同步流程使用了以下飞书接口：

1. 获取 tenant_access_token（当使用 AppId + AppSecret 时）  
   `POST /open-apis/auth/v3/tenant_access_token/internal`
2. 获取文档子块  
   `GET /open-apis/docx/v1/documents/:document_id/blocks/:block_id/children`
3. 批量删除子块（实现覆盖写入）  
   `DELETE /open-apis/docx/v1/documents/:document_id/blocks/:block_id/children/batch_delete`
4. 创建子块（写入新内容）  
   `POST /open-apis/docx/v1/documents/:document_id/blocks/:block_id/children`
5. Wiki 节点解析为实际 Docx 文档  
   `GET /open-apis/wiki/v2/spaces/get_node`

## 本地开发

```bash
npm install
npm run dev
```

## 打包

```bash
npm run build
```

构建结果目录：

```text
.output/chrome-mv3
```

## 安装（开发者模式）

1. 在 Chrome 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目构建目录 `.output/chrome-mv3`

## 使用说明

### 方式一：导出 Markdown（推荐先试）

1. 在微信读书网页保持登录状态
2. 点击插件图标打开页面
3. 勾选需要导出的书籍（支持一键全选）
4. 点击 **导出 Markdown（本地）**
5. 浏览器会下载每本书对应的 `.md` 文件

### 方式二：同步到飞书文档

1. 在微信读书网页保持登录状态
2. 点击插件图标打开页面
3. 填写：
   - 飞书文档地址（`https://xxx.feishu.cn/docx/xxxx` 或 `/wiki/xxxx`）
   - `AppId + AppSecret` 或 `tenant_access_token`
4. 勾选需要同步的书籍
5. 点击 **同步到飞书（覆盖原文档）**

## 注意事项

- **推荐先使用本地 Markdown 导出**，确认导出内容和结构符合预期
- 当前飞书同步是**覆盖目标文档原有内容**，不是增量同步
- 建议先用测试文档验证权限、token 和排版效果
- 插件会将飞书密钥信息保存在浏览器本地存储中，请勿在不可信设备上使用
- 微信读书网页接口如果发生变化，插件可能需要跟进调整
