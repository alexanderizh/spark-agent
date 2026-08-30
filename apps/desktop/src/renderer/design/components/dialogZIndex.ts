/**
 * 全局确认/输入弹窗的 z-index。
 *
 * antd v6 的根级 Modal 默认不设 z-index，纯靠 portal 的 DOM 顺序堆叠；
 * 而全局 ConfirmDialog / PromptDialog 的门户在首次打开后会常驻 body
 * （@rc-component/portal autoDestroy=false），之后再打开的普通弹窗
 * 门户反而排在后面、盖在确认弹窗之上。这里显式抬到与 antd 静态弹窗
 * 一致的层级（zIndexPopupBase 1000 + CONTAINER_MAX_OFFSET 1000），
 * 保证确认/输入弹窗始终位于所有普通弹窗之上。
 */
export const GLOBAL_DIALOG_Z_INDEX = 2000
