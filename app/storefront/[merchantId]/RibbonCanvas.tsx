'use client'

import { useEffect, useRef } from 'react'
import {
  Clock,
  Color,
  DoubleSide,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'

/**
 * The flowing ribbon behind the storefront hero.
 *
 * Two twisted bands drawn with a small custom shader. A ribbon is the one
 * shape that reads as motion while standing still, which is what this hero
 * needs: the page under it is a price list, so the background has to carry the
 * energy without ever competing with a number.
 *
 * Colour comes from the merchant's own hue, so Sherpa (220), Bizgram (178) and
 * Challenger (340) each get a different band out of the same geometry.
 *
 * Cost control, in order of how much they matter:
 *   - `prefers-reduced-motion` renders exactly one frame and stops.
 *   - The loop is suspended when the canvas scrolls out of view, and when the
 *     tab is hidden. A storefront is a page people leave open.
 *   - Device pixel ratio is capped at 2. Beyond that the band is smooth
 *     already and the fill cost is quadratic.
 */
export default function RibbonCanvas({ hue, className }: { hue: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    } catch {
      return // No WebGL. The hero's CSS wash is the fallback and is enough.
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearAlpha(0)
    el.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'

    const scene = new Scene()
    const camera = new PerspectiveCamera(38, 1, 0.1, 100)
    camera.position.set(0, 0, 9)

    /* The band's own palette, derived from the merchant hue. Kept high in
     * lightness: this sits under slate-700 body copy and must not pull the
     * page's contrast down. */
    const pale = new Color().setHSL(hue / 360, 0.5, 0.965)
    const tint = new Color().setHSL(hue / 360, 0.62, 0.76)
    const edge = new Color().setHSL(hue / 360, 0.45, 0.55)

    const uniforms = {
      uTime: { value: 0 },
      uPale: { value: pale },
      uTint: { value: tint },
      uEdge: { value: edge },
      uPhase: { value: 0 },
      uOpacity: { value: 1 },
    }

    const vertexShader = /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      varying vec2 vUv;
      varying float vFacing;

      void main() {
        vUv = uv;
        vec3 p = position;

        // Centre line of the band: two sines at incommensurate frequencies so
        // the crest never lands in the same place twice.
        float x = p.x;
        float wave = sin(x * 0.55 + uTime * 0.30 + uPhase) * 0.95
                   + sin(x * 1.15 - uTime * 0.19 + uPhase) * 0.28;
        float depth = cos(x * 0.48 + uTime * 0.24 + uPhase) * 0.85;

        // Twist: rotate each cross-section about the band's own axis. This is
        // what makes it read as a ribbon rather than as a wavy rectangle,
        // because the underside comes into view as the angle passes vertical.
        float twist = sin(x * 0.42 + uTime * 0.22 + uPhase) * 1.25;
        float w = p.y;

        p.y = wave + w * cos(twist);
        p.z = depth + w * sin(twist);

        // How square-on this part of the band is to the camera. Drives both
        // the sheen and the alpha, so edge-on sections fade instead of
        // collapsing into a hard line.
        vFacing = abs(cos(twist));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `

    const fragmentShader = /* glsl */ `
      uniform vec3 uPale;
      uniform vec3 uTint;
      uniform vec3 uEdge;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vFacing;

      void main() {
        // Across the band: pale in the middle, hue at the two edges.
        float acrossEdge = abs(vUv.y - 0.5) * 2.0;
        vec3 col = mix(uPale, uTint, smoothstep(0.15, 1.0, acrossEdge));

        // Turning away from the camera darkens toward the accent, the way a
        // real ribbon's underside does.
        col = mix(col, uEdge, (1.0 - vFacing) * 0.55);

        // Fine hatching along the length. This is the detail that stops a
        // large flat gradient from banding on 8-bit displays.
        float hatch = smoothstep(0.42, 0.5, abs(fract(vUv.x * 190.0) - 0.5));
        col = mix(col, col * 0.955, hatch * 0.5);

        // Fade both ends so the band leaves the frame instead of being cut.
        float ends = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x);

        float alpha = uOpacity * ends * (0.30 + 0.70 * vFacing);
        gl_FragColor = vec4(col, alpha);
      }
    `

    // Segmented heavily along its length, barely at all across: every bend
    // happens on the x axis.
    const geometry = new PlaneGeometry(26, 1.5, 260, 2)

    const makeBand = (phase: number, opacity: number, y: number, z: number) => {
      const material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          ...uniforms,
          uPhase: { value: phase },
          uOpacity: { value: opacity },
        },
      })
      const mesh = new Mesh(geometry, material)
      mesh.position.set(0, y, z)
      scene.add(mesh)
      return material
    }

    // Back band sits deeper and dimmer, which gives the pair some air.
    const materials = [makeBand(0, 0.95, -0.2, 0), makeBand(2.1, 0.5, 0.5, -2.2)]

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()

    const ro = new ResizeObserver(resize)
    ro.observe(el)

    const clock = new Clock()
    let raf = 0
    let onScreen = true

    const frame = () => {
      const t = clock.getElapsedTime()
      for (const m of materials) m.uniforms.uTime.value = t
      renderer.render(scene, camera)
      raf = requestAnimationFrame(frame)
    }

    const play = () => {
      if (raf || reduced) return
      clock.start()
      raf = requestAnimationFrame(frame)
    }
    const pause = () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
      clock.stop()
    }
    const sync = () => {
      if (onScreen && !document.hidden) play()
      else pause()
    }

    // One frame is drawn unconditionally, so a reduced-motion or paused canvas
    // still shows the band rather than nothing.
    renderer.render(scene, camera)

    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting
      sync()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    sync()

    return () => {
      pause()
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', sync)
      geometry.dispose()
      for (const m of materials) m.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [hue])

  return <div ref={host} className={className} aria-hidden />
}
