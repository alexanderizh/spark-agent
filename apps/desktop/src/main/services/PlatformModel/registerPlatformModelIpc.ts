import { typedIpcHandle } from '../../ipc/typed-ipc.js'
import { getPlatformModelService } from './PlatformModelService.js'

export function registerPlatformModelIpc(): void {
  typedIpcHandle('platform-model:get-status', async () => getPlatformModelService().getStatus())
  typedIpcHandle('platform-model:bootstrap', async () => getPlatformModelService().bootstrap(false))
  typedIpcHandle('platform-model:continue-on-this-device', async () => getPlatformModelService().bootstrap(true))
  typedIpcHandle('platform-model:get-plans', async () => ({ plans: await getPlatformModelService().getPlans() }))
  typedIpcHandle('platform-model:get-subscription', async () => ({
    subscription: await getPlatformModelService().getSubscription(),
  }))
  typedIpcHandle('platform-model:get-purchase-links', async () => ({
    links: await getPlatformModelService().getPurchaseLinks(),
  }))
  typedIpcHandle('platform-model:open-purchase-link', async (req) => (
    getPlatformModelService().openPurchaseLink(req.id)
  ))
  typedIpcHandle('platform-model:redeem', async (req) => getPlatformModelService().redeem(req.code))
  typedIpcHandle('platform-model:pay', async (req) => getPlatformModelService().pay(req.planId, req.paymentMethod))
  typedIpcHandle('platform-model:get-usage', async () => getPlatformModelService().getUsage())
  typedIpcHandle('platform-model:update-model-preferences', async (req) => (
    getPlatformModelService().updateModelPreferences(req)
  ))
}
