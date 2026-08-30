// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { panoramaZoomToRayScale } from './panoramaProjection'
import { createDefaultStage3DData, type Stage3DBackdropMode } from './stage3d.types'

const r3fState = vi.hoisted(() => ({ current: null as unknown }))

vi.mock('@react-three/fiber', async () => {
  const ReactModule = await import('react')
  const ThreeModule = await import('three')
  return {
    Canvas: ({ children }: { children: React.ReactNode }) => {
      const backdrop = ReactModule.Children.toArray(children).find(
        (child) =>
          ReactModule.isValidElement(child) &&
          typeof child.type === 'function' &&
          child.type.name === 'Backdrop',
      )
      return ReactModule.createElement('div', { 'data-r3f-canvas': true }, backdrop)
    },
    useLoader: vi.fn(() => new ThreeModule.Group()),
    useThree: () => r3fState.current,
  }
})

vi.mock('@react-three/drei', async () => {
  const ReactModule = await import('react')
  const ThreeModule = await import('three')
  const OrbitControls = ReactModule.forwardRef(function OrbitControlsMock(_props, ref) {
    ReactModule.useImperativeHandle(ref, () => ({
      enabled: true,
      target: new ThreeModule.Vector3(),
      update: vi.fn(),
    }))
    return null
  })
  return {
    Grid: () => ReactModule.createElement('div', { 'data-three-grid': true }),
    Html: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    OrbitControls,
    TransformControls: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    useGLTF: vi.fn(() => ({ scene: new ThreeModule.Group() })),
  }
})

vi.mock('antd', () => ({
  message: { error: vi.fn() },
}))

const { Scene3D } = await import('./Scene3D')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeData(mode: Stage3DBackdropMode, imageUrl?: string) {
  return {
    ...createDefaultStage3DData(),
    backdrop: { mode, imageUrl },
    actors: [],
    props: [],
    activeId: undefined,
  }
}

function sceneProps(mode: Stage3DBackdropMode, imageUrl?: string) {
  return {
    data: makeData(mode, imageUrl),
    cameraPreview: true,
    onSelect: vi.fn(),
    onActorTransform: vi.fn(),
    onCrowdTransform: vi.fn(),
    onPropTransform: vi.fn(),
    onCameraTransform: vi.fn(),
    transformMode: 'translate' as const,
    snap: false,
  }
}

describe('Scene3D backdrop rendering', () => {
  let container: HTMLDivElement
  let consoleError: ReturnType<typeof vi.spyOn>
  let root: Root
  let scene: THREE.Scene

  beforeEach(() => {
    const originalConsoleError = console.error
    consoleError = vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
      const text = String(message)
      if (
        text.includes('is unrecognized in this browser') ||
        text.includes('is using incorrect casing') ||
        text.includes('React does not recognize') ||
        text.includes('Unknown event handler property') ||
        text.includes('Invalid value for prop')
      ) {
        return
      }
      originalConsoleError(message, ...args)
    })

    class ImmediateImage {
      crossOrigin: string | null = null
      height = 1024
      naturalHeight = 1024
      naturalWidth = 2048
      onerror: (() => void) | null = null
      onload: (() => void) | null = null
      width = 2048

      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    vi.stubGlobal('Image', ImmediateImage)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    scene = new THREE.Scene()
    r3fState.current = {
      camera: new THREE.PerspectiveCamera(45, 1, 0.1, 200),
      gl: {
        getRenderTarget: vi.fn(() => null),
        readRenderTargetPixels: vi.fn(),
        render: vi.fn(),
        setClearColor: vi.fn(),
        setRenderTarget: vi.fn(),
      },
      scene,
      size: { height: 600, width: 800 },
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    consoleError.mockRestore()
    vi.unstubAllGlobals()
  })

  it('renders an equirectangular panorama as the scene environment instead of a flat plane', async () => {
    await act(async () => {
      root.render(<Scene3D {...sceneProps('panorama', 'https://example.com/panorama.jpg')} />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('shadermaterial')).not.toBeNull()
    expect(scene.background).toBeInstanceOf(THREE.Color)
  })

  it('keeps backdrop mode as a movable flat plane', () => {
    act(() => root.render(<Scene3D {...sceneProps('backdrop')} />))

    expect(container.querySelector('planegeometry')).not.toBeNull()
  })

  it('maps panorama zoom to inverse background ray scale', () => {
    expect(panoramaZoomToRayScale(0.5)).toBe(2)
    expect(panoramaZoomToRayScale(1)).toBe(1)
    expect(panoramaZoomToRayScale(2)).toBe(0.5)
    expect(panoramaZoomToRayScale(99)).toBe(0.5)
  })
})
