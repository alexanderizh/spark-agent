const vert = `attribute vec3 position;attribute vec3 normal;uniform mat3 rotation;uniform float aspect;varying vec3 N;varying vec3 P;varying vec3 O;void main(){O=position;P=rotation*position;N=rotation*normal;float z=5.0-P.z;gl_Position=vec4(P.x*2.0/aspect,P.y*2.0,-P.z*.1,z);}`
const frag = `precision mediump float;varying vec3 N;varying vec3 P;varying vec3 O;uniform float dark;uniform float material;void main(){vec3 n=normalize(N);if(!gl_FrontFacing)n=-n;vec3 v=normalize(vec3(0.,0.,5.)-P);vec3 r=reflect(-v,n);float f=pow(1.-max(dot(n,v),0.),2.8);float key=max(dot(n,normalize(vec3(-.4,.9,1.3))),0.);float softbox=pow(max(0.,1.-abs(r.x+.35)*1.3),14.)*smoothstep(-.3,.5,r.y);float edge=pow(max(0.,1.-abs(r.y-.72)*2.),28.);float x=clamp((O.x+1.6)/3.2,0.,1.);vec3 c=mix(vec3(.12,.40,.82),vec3(.52,.19,.71),smoothstep(0.,.48,x));c=mix(c,vec3(.91,.29,.40),smoothstep(.40,.78,x));c=mix(c,vec3(1.,.65,.28),smoothstep(.75,1.,x));c=mix(c,vec3(.34,.79,.84),max(0.,O.y)*.25);vec3 col=c*(.65+key*.40)+softbox*.40+edge*.22+f*.14;col=mix(col,vec3(.98,.91,.98),f*.12);gl_FragColor=vec4(col,1.);}`
type Vec3 = [number, number, number]
function norm(a: Vec3): Vec3 {
  const l = Math.hypot(...a)
  return a.map((x) => x / l) as Vec3
}
function surface(t: number, w: number): Vec3 {
  const a = ((w + 0.34) / 0.68) * Math.PI * 2
  const p: Vec3 = [1.42 * Math.sin(t), 0.64 * Math.sin(2 * t), 0.34 * Math.cos(t)]
  const d = norm([1.42 * Math.cos(t), 1.28 * Math.cos(2 * t), -0.34 * Math.sin(t)])
  const u = norm([-d[1], d[0], 0]),
    v: Vec3 = [-d[2] * u[1], d[2] * u[0], d[0] * u[1] - d[1] * u[0]]
  const twist = 0.48 * Math.sin(t) + 0.28
  return p.map(
    (x, k) =>
      x +
      (0.235 * Math.cos(a) * Math.cos(twist) - 0.075 * Math.sin(a) * Math.sin(twist)) * u[k]! +
      (0.235 * Math.cos(a) * Math.sin(twist) + 0.075 * Math.sin(a) * Math.cos(twist)) * v[k]!,
  ) as Vec3
}
function point(t: number, w: number) {
  const p = surface(t, w),
    q = surface(t + 0.0001, w),
    r = surface(t, w + 0.0001),
    a = q.map((x, i) => x - p[i]!) as Vec3,
    b = r.map((x, i) => x - p[i]!) as Vec3
  const n = norm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]])
  return [...p, ...n]
}
const vertices: number[] = []
for (let i = 0; i < 320; i++)
  for (let j = 0; j < 24; j++) {
    const t = (i / 320) * Math.PI * 2,
      w = -0.34 + (j / 24) * 0.68,
      t2 = ((i + 1) / 320) * Math.PI * 2,
      w2 = -0.34 + ((j + 1) / 24) * 0.68
    for (const p of [
      point(t, w),
      point(t2, w),
      point(t2, w2),
      point(t, w),
      point(t2, w2),
      point(t, w2),
    ])
      vertices.push(...p)
  }

/** Lightweight shared renderer; returns a complete GPU/listener cleanup. */
export function mountSparkRibbon(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
  if (!gl) throw new Error('WebGL unavailable')
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  const release = () => {
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    shaders.forEach((shader) => gl.deleteShader(shader))
  }
  try {
    program = gl.createProgram()
    if (!program) throw new Error('Unable to create program')
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vert],
      [gl.FRAGMENT_SHADER, frag],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Unable to create shader')
      shaders.push(shader)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error('Shader compile failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed')
    gl.useProgram(program)
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW)
    for (const [name, offset] of [
      ['position', 0],
      ['normal', 12],
    ] as const) {
      const loc = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 24, offset)
    }
    gl.enable(gl.DEPTH_TEST)
  } catch (error) {
    release()
    throw error
  }
  const rotation = gl.getUniformLocation(program!, 'rotation')
  const aspect = gl.getUniformLocation(program!, 'aspect')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let pointerX = 0,
    pointerY = 0,
    x = 0,
    y = 0,
    raf = 0,
    last = -Infinity,
    disposed = false
  const onPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    pointerX = Math.max(
      -0.1,
      Math.min(0.1, ((event.clientX - rect.left - rect.width / 2) / rect.width) * 0.15),
    )
    pointerY = Math.max(
      -0.1,
      Math.min(0.1, ((event.clientY - rect.top - rect.height / 2) / rect.height) * 0.12),
    )
  }
  const rotate = (p: number[], a: number, b: number, c: number) => {
    let [x, y, z] = p as Vec3
    ;[y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
    ;[x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)]
    return [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z]
  }
  const frame = (time: number) => {
    if (disposed) return
    if (!document.hidden && time - last > 32 && !gl.isContextLost()) {
      const w = canvas.clientWidth,
        h = canvas.clientHeight
      if (w && h) {
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
          canvas.width = Math.round(w * ratio)
          canvas.height = Math.round(h * ratio)
        }
        x += (pointerX - x) * 0.06
        y += (pointerY - y) * 0.06
        const phase = reduced.matches ? 0 : time * 0.00035
        const matrix = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ].flatMap((p) =>
          rotate(
            p,
            0.12 + (reduced.matches ? 0 : y),
            0.2 + Math.sin(phase) * 0.22 + (reduced.matches ? 0 : x),
            -0.27 + Math.sin(phase * 0.7) * 0.09,
          ),
        )
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.uniformMatrix3fv(rotation, false, new Float32Array(matrix))
        gl.uniform1f(aspect, w / h)
        gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 6)
      }
      last = time
    }
    if (!reduced.matches && !document.hidden) raf = requestAnimationFrame(frame)
  }
  const restart = () => {
    cancelAnimationFrame(raf)
    last = -Infinity
    raf = requestAnimationFrame(frame)
  }
  const resize = new ResizeObserver(restart)
  resize.observe(canvas)
  canvas.addEventListener('pointermove', onPointer)
  reduced.addEventListener('change', restart)
  document.addEventListener('visibilitychange', restart)
  restart()
  return () => {
    disposed = true
    cancelAnimationFrame(raf)
    resize.disconnect()
    canvas.removeEventListener('pointermove', onPointer)
    reduced.removeEventListener('change', restart)
    document.removeEventListener('visibilitychange', restart)
    release()
  }
}
