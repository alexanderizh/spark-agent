import { useEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'
import { panoramaZoomToRayScale } from './panoramaProjection'

const VERTEX_SHADER = `
  varying vec2 vClipPosition;

  void main() {
    vClipPosition = position.xy;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  uniform sampler2D panoramaMap;
  uniform mat4 cameraProjectionInverse;
  uniform mat4 cameraWorldMatrix;
  uniform float panoramaRotationY;
  uniform float panoramaRayScale;
  varying vec2 vClipPosition;

  const float RECIPROCAL_PI = 0.3183098861837907;
  const float RECIPROCAL_PI2 = 0.15915494309189535;

  void main() {
    vec4 viewTarget = cameraProjectionInverse * vec4(vClipPosition, 1.0, 1.0);
    vec3 viewDirection = normalize(viewTarget.xyz / viewTarget.w);
    viewDirection.xy *= panoramaRayScale;

    vec3 worldDirection = normalize(
      (cameraWorldMatrix * vec4(normalize(viewDirection), 0.0)).xyz
    );

    float rotationCos = cos(panoramaRotationY);
    float rotationSin = sin(panoramaRotationY);
    vec3 sampleDirection = vec3(
      rotationCos * worldDirection.x - rotationSin * worldDirection.z,
      worldDirection.y,
      rotationSin * worldDirection.x + rotationCos * worldDirection.z
    );

    vec2 sampleUv = vec2(
      atan(sampleDirection.z, sampleDirection.x) * RECIPROCAL_PI2 + 0.5,
      asin(clamp(sampleDirection.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5
    );

    gl_FragColor = texture2D(panoramaMap, sampleUv);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

type PanoramaUniforms = {
  panoramaMap: { value: THREE.Texture }
  cameraProjectionInverse: { value: THREE.Matrix4 }
  cameraWorldMatrix: { value: THREE.Matrix4 }
  panoramaRotationY: { value: number }
  panoramaRayScale: { value: number }
}

export type PanoramaBackgroundProps = {
  texture: THREE.Texture
  rotationY: number
  zoom: number
}

export function PanoramaBackground({ texture, rotationY, zoom }: PanoramaBackgroundProps) {
  const { gl, scene } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const rayScale = panoramaZoomToRayScale(zoom)
  const uniforms = useMemo<PanoramaUniforms>(
    () => ({
      panoramaMap: { value: texture },
      cameraProjectionInverse: { value: new THREE.Matrix4() },
      cameraWorldMatrix: { value: new THREE.Matrix4() },
      panoramaRotationY: { value: rotationY },
      panoramaRayScale: { value: rayScale },
    }),
    [rayScale, rotationY, texture],
  )

  useEffect(() => {
    // The shader draws the panorama first; the scene color remains the loading/fallback clear.
    // eslint-disable-next-line react-hooks/immutability
    scene.background = new THREE.Color('#0b1220')
    scene.backgroundRotation.set(0, 0, 0)
    gl.setClearColor('#0b1220', 1)

    return () => {
      scene.background = new THREE.Color('#0b1220')
      scene.backgroundRotation.set(0, 0, 0)
      gl.setClearColor('#0b1220', 1)
    }
  }, [gl, scene])

  const syncRenderCamera: ThreeElements['mesh']['onBeforeRender'] = (_renderer, _scene, camera) => {
    const material = materialRef.current
    if (!material) return
    const activeUniforms = material.uniforms as PanoramaUniforms
    activeUniforms.cameraProjectionInverse.value.copy(camera.projectionMatrixInverse)
    activeUniforms.cameraWorldMatrix.value.copy(camera.matrixWorld)
  }

  return (
    <mesh
      frustumCulled={false}
      renderOrder={-1000}
      raycast={() => undefined}
      onBeforeRender={syncRenderCamera}
      userData={{ stage3dPanoramaBackground: true }}
    >
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        depthTest={false}
        depthWrite={false}
        toneMapped
      />
    </mesh>
  )
}
