import app from 'ags/gtk4/app'
import { Astal, Gtk } from 'ags/gtk4'
import Adw from 'gi://Adw'
import AstalWp from 'gi://AstalWp'
import GLib from 'gi://GLib'
import type Cairo from 'cairo'

const VISIBLE_MARGIN = 24
const HIDDEN_MARGIN = -320
const SHOW_DURATION_MS = 2500
const BAR_RADIUS = 8
const BAR_WIDTH = 14
const HANDLE_RADIUS = 10

function appendRoundedRect(cr: Cairo.Context, x: number, y: number, w: number, h: number, r: number) {
    const cr_r = Math.min(r, w / 2, h / 2)
    if (cr_r <= 0 || w <= 0 || h <= 0) {
        return
    }
    const rx = x + w
    const by = y + h
    cr.newSubPath()
    cr.arc(rx - cr_r, y + cr_r, cr_r, -Math.PI / 2, 0)
    cr.arc(rx - cr_r, by - cr_r, cr_r, 0, Math.PI / 2)
    cr.arc(x + cr_r, by - cr_r, cr_r, Math.PI / 2, Math.PI)
    cr.arc(x + cr_r, y + cr_r, cr_r, Math.PI, 3 * Math.PI / 2)
    cr.closePath()
}

export default function VolumeIndicator() {
    const wp = AstalWp.get_default()

    let win: Astal.Window | null = null
    let iconWidget: Gtk.Image | null = null
    let labelWidget: Gtk.Label | null = null
    let drawArea: Gtk.DrawingArea | null = null
    let animation: Adw.SpringAnimation | null = null
    let currentMargin = HIDDEN_MARGIN
    let hideTimeoutId: number | null = null
    let currentVolume = 0
    let currentMuted = false
    let isHovered = false
    let isDragging = false
    let isHoveredZone = false

    const queueDraw = () => {
        if (drawArea !== null) {
            drawArea.queue_draw()
        }
    }

    const updateContent = () => {
        if (wp === null) {
            return
        }

        const speaker = wp.defaultSpeaker
        if (speaker === null || speaker === undefined) {
            return
        }

        currentVolume = speaker.volume
        currentMuted = speaker.mute
        const pct = Math.round(currentVolume * 100)

        if (labelWidget !== null) {
            labelWidget.set_label(currentMuted ? 'Muted' : `${pct}%`)
        }

        if (iconWidget !== null) {
            let iconName: string
            if (currentMuted || currentVolume <= 0) {
                iconName = 'audio-volume-muted-symbolic'
            } else if (currentVolume < 0.33) {
                iconName = 'audio-volume-low-symbolic'
            } else if (currentVolume < 0.66) {
                iconName = 'audio-volume-medium-symbolic'
            } else {
                iconName = 'audio-volume-high-symbolic'
            }
            iconWidget.set_from_icon_name(iconName)
        }

        queueDraw()
    }

    const setSpeakerVolume = (vol: number) => {
        if (wp === null) {
            return
        }

        const speaker = wp.defaultSpeaker
        if (speaker === null || speaker === undefined) {
            return
        }

        speaker.volume = Math.max(0, Math.min(1, vol))
    }

    const toggleMute = () => {
        if (wp === null) {
            return
        }

        const speaker = wp.defaultSpeaker
        if (speaker === null || speaker === undefined) {
            return
        }

        speaker.mute = !speaker.mute
    }

    const drawVolumeBar = (_area: Gtk.DrawingArea, cr: Cairo.Context, width: number, height: number) => {
        const barX = (width - BAR_WIDTH) / 2
        // Reserve space for handle at top and bottom so it never clips adjacent widgets
        const pad = HANDLE_RADIUS + 2
        const barTop = pad
        const barEff = height - 2 * pad

        // Track background
        appendRoundedRect(cr, barX, barTop, BAR_WIDTH, barEff, BAR_RADIUS)
        cr.setSourceRGBA(1, 1, 1, 0.12)
        cr.fill()

        if (!currentMuted && currentVolume > 0) {
            const fillHeight = Math.min(1, currentVolume) * barEff
            const fillTop = barTop + barEff - fillHeight

            // Clip to filled region, draw the three colour zones inside
            cr.save()
            appendRoundedRect(cr, barX, fillTop, BAR_WIDTH, fillHeight, BAR_RADIUS)
            cr.clip()

            // Red zone: top 25% (75–100% volume)
            cr.setSourceRGB(0.90, 0.25, 0.25)
            cr.rectangle(barX, barTop, BAR_WIDTH, barEff * 0.25)
            cr.fill()

            // Yellow zone: next 25% (50–75% volume)
            cr.setSourceRGB(0.92, 0.78, 0.10)
            cr.rectangle(barX, barTop + barEff * 0.25, BAR_WIDTH, barEff * 0.25)
            cr.fill()

            // Green zone: bottom 50% (0–50% volume)
            cr.setSourceRGB(0.25, 0.80, 0.38)
            cr.rectangle(barX, barTop + barEff * 0.5, BAR_WIDTH, barEff * 0.5)
            cr.fill()

            cr.restore()
        }

        if (isHovered || isDragging) {
            const vol = currentMuted ? 0 : Math.min(1, currentVolume)
            const handleY = barTop + barEff - vol * barEff
            const cx = width / 2

            // Drop shadow
            cr.arc(cx + 0.5, handleY + 1, HANDLE_RADIUS, 0, 2 * Math.PI)
            cr.setSourceRGBA(0, 0, 0, 0.28)
            cr.fill()

            // Handle
            cr.arc(cx, handleY, HANDLE_RADIUS, 0, 2 * Math.PI)
            cr.setSourceRGBA(1, 1, 1, 0.95)
            cr.fill()
        }
    }

    const initDrawArea = (area: Gtk.DrawingArea) => {
        drawArea = area
        area.set_draw_func(drawVolumeBar)

        let dragStartY = 0

        const drag = new Gtk.GestureDrag()
        drag.connect('drag-begin', (_g: Gtk.GestureDrag, _x: number, startY: number) => {
            isDragging = true
            dragStartY = startY
            const h = area.get_height()
            if (h > 0) {
                const pad = HANDLE_RADIUS + 2
                const barEff = h - 2 * pad
                setSpeakerVolume(1 - (startY - pad) / barEff)
            }
            cancelHide()
        })
        drag.connect('drag-update', (_g: Gtk.GestureDrag, _dx: number, dy: number) => {
            const h = area.get_height()
            if (h <= 0) {
                return
            }
            const pad = HANDLE_RADIUS + 2
            const barEff = h - 2 * pad
            setSpeakerVolume(1 - (dragStartY + dy - pad) / barEff)
        })
        drag.connect('drag-end', () => {
            isDragging = false
            queueDraw()
            if (!isHovered) {
                scheduleHide()
            }
        })
        area.add_controller(drag)
    }

    const initOuterBox = (box: Gtk.Box) => {
        const motion = new Gtk.EventControllerMotion()
        motion.connect('enter', () => {
            isHovered = true
            cancelHide()
            queueDraw()
        })
        motion.connect('leave', () => {
            isHovered = false
            queueDraw()
            if (!isDragging) {
                scheduleHide()
            }
        })
        box.add_controller(motion)

        const scroll = new Gtk.EventControllerScroll()
        scroll.flags = Gtk.EventControllerScrollFlags.VERTICAL
        scroll.connect('scroll', (_ctrl: Gtk.EventControllerScroll, _dx: number, dy: number) => {
            const step = 0.05
            setSpeakerVolume(currentVolume - dy * step)
            return true
        })
        box.add_controller(scroll)
    }

    const ensureAnimation = () => {
        if (win === null || animation !== null) {
            return
        }

        const target = Adw.CallbackAnimationTarget.new((value: number) => {
            if (win === null) {
                return
            }
            win.set_margin_right(Math.round(value))
            currentMargin = value
        })

        animation = Adw.SpringAnimation.new(
            win,
            HIDDEN_MARGIN,
            VISIBLE_MARGIN,
            Adw.SpringParams.new(0.68, 1, 340),
            target,
        )
        animation.epsilon = 0.002
        animation.initialVelocity = 0
        animation.clamp = false
    }

    const slideIn = () => {
        if (win === null) {
            return
        }

        ensureAnimation()

        if (animation === null) {
            win.set_margin_right(VISIBLE_MARGIN)
            currentMargin = VISIBLE_MARGIN
            return
        }

        animation.clamp = false
        animation.valueFrom = currentMargin
        animation.valueTo = VISIBLE_MARGIN
        animation.initialVelocity = 0
        animation.play()
    }

    const slideOut = () => {
        if (win === null) {
            return
        }

        ensureAnimation()

        if (animation === null) {
            win.set_margin_right(HIDDEN_MARGIN)
            currentMargin = HIDDEN_MARGIN
            return
        }

        animation.clamp = true
        animation.valueFrom = currentMargin
        animation.valueTo = HIDDEN_MARGIN
        animation.initialVelocity = 0
        animation.play()
    }

    const cancelHide = () => {
        if (hideTimeoutId !== null) {
            GLib.source_remove(hideTimeoutId)
            hideTimeoutId = null
        }
    }

    const scheduleHide = () => {
        cancelHide()

        if (isHovered || isHoveredZone || isDragging) {
            return
        }

        hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DURATION_MS, () => {
            hideTimeoutId = null
            slideOut()
            return GLib.SOURCE_REMOVE
        })
    }

    const onVolumeChanged = () => {
        updateContent()
        slideIn()
        scheduleHide()
    }

    const initWindow = (w: Astal.Window) => {
        win = w
        w.set_margin_right(HIDDEN_MARGIN)
        currentMargin = HIDDEN_MARGIN

        if (wp === null) {
            return
        }

        let currentSpeaker: AstalWp.Endpoint | null = null
        let speakerHandlers: number[] = []

        const detachSpeaker = () => {
            if (currentSpeaker !== null) {
                for (const id of speakerHandlers) {
                    currentSpeaker.disconnect(id)
                }
            }
            speakerHandlers = []
            currentSpeaker = null
        }

        const attachSpeaker = (speaker: AstalWp.Endpoint | null | undefined) => {
            detachSpeaker()
            if (speaker === null || speaker === undefined) {
                return
            }
            currentSpeaker = speaker
            speakerHandlers = [
                speaker.connect('notify::volume', () => onVolumeChanged()),
                speaker.connect('notify::mute', () => onVolumeChanged()),
            ]
            updateContent()
        }

        attachSpeaker(wp.defaultSpeaker)

        const defaultSpeakerHandler = wp.connect('notify::default-speaker', () => {
            attachSpeaker(wp.defaultSpeaker)
        })

        const destroyHandler = w.connect('destroy', () => {
            wp.disconnect(defaultSpeakerHandler)
            detachSpeaker()

            cancelHide()

            if (animation !== null) {
                animation.reset()
                animation = null
            }

            w.disconnect(destroyHandler)
            win = null
        })
    }

    const initZoneWindow = (zoneWin: Astal.Window) => {
        const motion = new Gtk.EventControllerMotion()
        motion.connect('enter', () => {
            isHoveredZone = true
            cancelHide()
            slideIn()
        })
        motion.connect('leave', () => {
            isHoveredZone = false
            if (!isHovered && !isDragging) {
                scheduleHide()
            }
        })
        const root = zoneWin.get_child()
        if (root !== null) {
            root.add_controller(motion)
        } else {
            zoneWin.add_controller(motion)
        }
    }

    const _zoneWindow = (
        <window
            visible
            name="hyprbobr-volume-zone"
            namespace="hyprbobr-volume-zone"
            class="volume-edge-zone"
            layer={Astal.Layer.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            keymode={Astal.Keymode.NONE}
            anchor={Astal.WindowAnchor.RIGHT}
            application={app}
            $={(self) => initZoneWindow(self as Astal.Window)}
        >
            <box widthRequest={1} heightRequest={270} />
        </window>
    )

    return (
        <window
            visible
            name="hyprbobr-volume"
            namespace="hyprbobr-volume"
            class="volume-indicator-window"
            layer={Astal.Layer.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            keymode={Astal.Keymode.NONE}
            anchor={Astal.WindowAnchor.RIGHT}
            application={app}
            marginRight={HIDDEN_MARGIN}
            $={(self) => initWindow(self as Astal.Window)}
        >
            <box
                class="volume-indicator"
                orientation={Gtk.Orientation.VERTICAL}
                spacing={10}
                marginTop={16}
                marginBottom={16}
                marginStart={14}
                marginEnd={14}
                $={(self) => initOuterBox(self as Gtk.Box)}
            >
                <label
                    label="—"
                    halign={Gtk.Align.CENTER}
                    xalign={0.5}
                    class="volume-value-label"
                    $={(self) => { labelWidget = self }}
                />
                <drawingarea
                    widthRequest={34}
                    heightRequest={160}
                    halign={Gtk.Align.CENTER}
                    canTarget={true}
                    $={(self) => initDrawArea(self)}
                />
                <button
                    class="volume-mute-button"
                    halign={Gtk.Align.CENTER}
                    onClicked={() => toggleMute()}
                >
                    <image
                        iconName="audio-volume-high-symbolic"
                        pixelSize={28}
                        $={(self) => { iconWidget = self }}
                    />
                </button>
            </box>
        </window>
    )
}
