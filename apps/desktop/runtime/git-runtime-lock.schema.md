# Git Runtime Lock 说明

`git-runtime-lock.json` 固定桌面发布矩阵中每个正式 target 的内置 Git runtime 制品。

## 字段

- `schemaVersion`: 锁文件结构版本，当前为 `1`。
- `targets[]`: 每个正式发布 target 一条记录。
  - `artifactId`: Spark 制品仓库中的制品 ID，形如 `runtime.git-<version>.<platform>-<arch>`。
  - `version`: 上游 Git 版本（如 `2.45.4`）。
  - `platform`: `darwin` | `win32`；`arch`: `arm64` | `x64`。
  - `archiveSha256`: 已通过公网下载复验的归档 SHA256。发布 job 必须精确匹配该值，禁止按前缀或 latest 选择。
  - `archiveSizeBytes`: 归档大小（字节）。
  - `entry`: runtime 根目录内 git 可执行文件相对路径（POSIX 分隔符），如 `bin/git`。
  - `execPath`: `libexec/git-core` 相对路径；runtime 可重定位时不设置。
  - `sbomSha256`: 对应 SBOM 文件摘要。

## 规则

1. 发布 job 中 target 在锁内无匹配条目时**直接失败**（fail closed），禁止退化为“依赖用户系统 Git”。
2. 条目只能由 Phase 0 制品门禁通过后人工添加：上游签名校验、SBOM/provenance、CVE 扫描、公网 GET 复验 SHA256 全部通过。
3. 归档内容必须是完整可重定向前缀：`bin/`、`libexec/git-core/`、`templates/`、CA bundle、许可证与第三方声明。
4. 唯一例外：`targets` 为**空数组**时表示 Phase 0 制品尚未入库、内置 Git runtime 对整条发布线未启用，打包脚本跳过 runtime 交付并输出显式警告（发布继续依赖系统 Git）。只要锁内存在任何条目，规则 1 的 fail closed 对全部正式 target 生效；不允许通过删除单个平台条目来跳过该平台。
