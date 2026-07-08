# Flexbox Layout Components Guide

`@lobehub/ui` provides `Flexbox` and `Center` for layouts.

## Flexbox

- Default vertical; use `horizontal` for row. Props: horizontal, flex, gap, align, justify, padding, paddingInline/Block, width/height, style.
- Use `flex={1}` to fill space; `gap` for spacing; `overflow: 'auto'` for scroll.

## Center

Wraps Flexbox with horizontal and vertical centering. Usage: `<Center width={'100%'} height={'100%'}><Content /></Center>`.

## Example

```jsx
<Flexbox horizontal height={'100%'} width={'100%'}>
  <Flexbox width={260} style={{ borderRight, height: '100%', overflowY: 'auto' }}><Sidebar /></Flexbox>
  <Flexbox flex={1} style={{ height: '100%' }}><MainContent /></Flexbox>
</Flexbox>
```
