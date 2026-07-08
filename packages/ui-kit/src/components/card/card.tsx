/**
 * Card 组件
 *
 * 设计稿中出现频次最高的组件（79 次）。
 * 提供多种变体：默认卡片、交互式卡片（可点击）、指标卡片。
 *
 * @example
 *   <Card>
 *     <Card.Header>标题</Card.Header>
 *     <Card.Body>内容</Card.Body>
 *   </Card>
 *
 *   <Card variant="interactive" onClick={handleClick}>
 *     可点击的卡片
 *   </Card>
 */

import { forwardRef, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../utils/cn'

const cardVariants = cva(
  ['rounded-md border border-border bg-panel shadow-xs'],
  {
    variants: {
      variant: {
        default: '',
        interactive: [
          'cursor-pointer',
          'hover:bg-soft hover:border-border-strong hover:shadow-sm',
          'active:bg-sunken',
          'transition-all duration-150',
        ],
        elevated: 'bg-panel-elev shadow-sm',
        outline: 'bg-transparent',
        sunken: 'bg-sunken',
      },
      padding: {
        none: '',
        sm: 'p-2',
        md: 'p-3',
        lg: 'p-4',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'md',
    },
  },
)

type CardPropsInternal = HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants>

export type CardProps = CardPropsInternal

const Card = forwardRef<HTMLDivElement, CardPropsInternal>(
  ({ className, variant, padding, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(cardVariants({ variant, padding, className }))}
        {...props}
      />
    )
  },
)
Card.displayName = 'Card'

/* ---- Card.Header ---- */
export type CardHeaderProps = HTMLAttributes<HTMLDivElement>

const CardHeader = forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 pb-2', className)}
      {...props}
    />
  ),
)
CardHeader.displayName = 'CardHeader'

/* ---- Card.Title ---- */
export type CardTitleProps = HTMLAttributes<HTMLHeadingElement>

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        'text-[var(--font-lg)] font-semibold text-text-strong',
        className,
      )}
      {...props}
    />
  ),
)
CardTitle.displayName = 'CardTitle'

/* ---- Card.Description ---- */
export type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement>

const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-[var(--font-sm)] text-text-muted', className)}
      {...props}
    />
  ),
)
CardDescription.displayName = 'CardDescription'

/* ---- Card.Body ---- */
export type CardBodyProps = HTMLAttributes<HTMLDivElement>

const CardBody = forwardRef<HTMLDivElement, CardBodyProps>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(className)} {...props} />
  ),
)
CardBody.displayName = 'CardBody'

/* ---- Card.Footer ---- */
export type CardFooterProps = HTMLAttributes<HTMLDivElement>

const CardFooter = forwardRef<HTMLDivElement, CardFooterProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 pt-2', className)}
      {...props}
    />
  ),
)
CardFooter.displayName = 'CardFooter'

// 组合导出
const CardCompound = Object.assign(Card, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Body: CardBody,
  Footer: CardFooter,
})

export { CardCompound as Card, cardVariants }
