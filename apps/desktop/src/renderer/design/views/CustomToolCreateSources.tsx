import { Icons } from '../Icons'

interface CustomToolCreateSourcesProps {
  onBlank: () => void
  onCurl: () => void
  onCode: () => void
  onOpenTemplates: () => void
  onImportPackage: () => void
}

/**
 * 顶层只表达通用创建来源，不展示任何具体业务能力。
 * 具体能力（包括图像理解参考用例）统一收进二级模板列表。
 */
export function CustomToolCreateSources({
  onBlank,
  onCurl,
  onCode,
  onOpenTemplates,
  onImportPackage,
}: CustomToolCreateSourcesProps) {
  return (
    <div className="ct_create_sources">
      <button type="button" onClick={onBlank}>
        <Icons.Code size={18} />
        <span>
          <strong>从空白创建</strong>
          <small>定义工具名称、输入 Schema 与执行方式，不绑定具体业务能力。</small>
        </span>
      </button>
      <button type="button" onClick={onCurl}>
        <Icons.ChevronRight size={18} />
        <span>
          <strong>粘贴 cURL</strong>
          <small>自动拆解方法、Header、Body 与密钥引用。</small>
        </span>
      </button>
      <button type="button" onClick={onCode}>
        <Icons.ChevronRight size={18} />
        <span>
          <strong>导入 OpenAPI</strong>
          <small>选择 operation 后批量生成待审草稿 · 开发中</small>
        </span>
      </button>
      <button type="button" disabled>
        <Icons.ChevronRight size={18} />
        <span>
          <strong>编写 TypeScript</strong>
          <small>开发真实业务逻辑，并通过权限白名单组合其他工具。</small>
        </span>
      </button>
      <button type="button" onClick={onOpenTemplates}>
        <Icons.ChevronRight size={18} />
        <span>
          <strong>使用模板</strong>
          <small>从可替换模板开始；具体能力不会成为默认入口。</small>
        </span>
      </button>
      <button type="button" onClick={onImportPackage}>
        <Icons.ChevronRight size={18} />
        <span>
          <strong>导入工具包</strong>
          <small>导入 Spark 自定义工具 JSON，作为未发布待审草稿。</small>
        </span>
      </button>
    </div>
  )
}

interface CustomToolTemplateSourcesProps {
  onHttp: () => void
  onVision: () => void
}

export function CustomToolTemplateSources({ onHttp, onVision }: CustomToolTemplateSourcesProps) {
  return (
    <div className="ct_create_sources">
      <button type="button" onClick={onHttp}>
        <Icons.Code size={18} />
        <span>
          <strong>HTTP API</strong>
          <small>声明请求、Schema 与响应映射，适合 REST / 内网服务。</small>
        </span>
      </button>
      <button type="button" onClick={onVision}>
        <Icons.Image size={18} />
        <span>
          <strong>图像理解</strong>
          <small>参考模板：复用多模态 Provider，为文本模型补充视觉能力。</small>
        </span>
      </button>
    </div>
  )
}
