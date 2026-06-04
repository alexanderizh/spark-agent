/**
 * @spark/ui-kit
 *
 * Spark Agent UI 组件库
 * 基于 Radix UI 无头组件 + Tailwind CSS v4 设计系统
 */

// 工具
export { cn } from './utils/cn'

// 组件
export { Button, buttonVariants, type ButtonProps } from './components/button'
export { Badge, badgeVariants, type BadgeProps } from './components/badge'
export {
  Card,
  cardVariants,
  type CardProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardDescriptionProps,
  type CardBodyProps,
  type CardFooterProps,
} from './components/card'
export { Separator, type SeparatorProps } from './components/separator'
export { Input, inputVariants, type InputProps } from './components/input'
export { Tooltip, TooltipProvider, type TooltipProps } from './components/tooltip'
export { ScrollArea, ScrollBar, type ScrollAreaProps } from './components/scroll-area'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './components/tabs'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from './components/dropdown-menu'
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './components/dialog'
