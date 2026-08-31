-- 092: 工具包导入溯源字段（压缩包 / Git 仓库导入）
-- source_url        Git 导入来源地址（本地仓库路径或克隆 URL）；其他来源为 NULL
-- source_ref        Git 导入使用的分支 / 标签；未指定为 NULL
-- source_subdirectory 包位于来源（仓库或压缩包）内的子目录；位于根为 NULL
ALTER TABLE tool_package_versions ADD COLUMN source_url TEXT;
ALTER TABLE tool_package_versions ADD COLUMN source_ref TEXT;
ALTER TABLE tool_package_versions ADD COLUMN source_subdirectory TEXT;
