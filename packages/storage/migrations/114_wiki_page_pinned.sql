-- 114: 知识页置顶标记（目录树「置顶」功能，对齐会话侧栏的置顶交互）。
--
-- 语义：pinned=1 的页面在其同级分组内浮到最前展示（渲染端排序，不动服务端
-- ORDER BY 口径）；置顶是纯展示元数据——不改正文、不推进 version、不留
-- 历史版本，因此走独立 UPDATE 而非统一写入原语的内容提交路径。
-- 拖拽排序的 sort_order 在 112 已就绪，本迁移只补置顶位。

ALTER TABLE wiki_page ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- 置顶段取数：同级分组内 pinned 优先。与既有 idx_wiki_page_space 互补。
CREATE INDEX IF NOT EXISTS idx_wiki_page_pinned ON wiki_page(space_id, pinned, sort_order);
