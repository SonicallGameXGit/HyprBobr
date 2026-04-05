import app from 'ags/gtk4/app'
import { Astal, Gtk, Gdk } from 'ags/gtk4'
import { createPoll } from 'ags/time'
import { createBinding, For } from 'ags'
import AstalTray from 'gi://AstalTray'
import AstalHyprland from 'gi://AstalHyprland'
import Adw from 'gi://Adw'
import GLib from 'gi://GLib'
import type Cairo from 'cairo'

type WorkspaceBounds = {
    x: number
    width: number
}

type BubbleState = {
    visible: boolean
    startX: number
    targetX: number
    startWidth: number
    targetWidth: number
    currentX: number
    currentWidth: number
    currentScaleY: number
    currentWidthBoost: number
}

function clamp(value: number, min: number, max: number) {
    if (value < min) {
        return min
    }

    if (value > max) {
        return max
    }

    return value
}

function lerp(from: number, to: number, progress: number) {
    return from + (to - from) * progress
}

function appendRoundedRectangle(cr: Cairo.Context, x: number, y: number, width: number, height: number, radius: number) {
    const clampedRadius = Math.min(radius, width / 2, height / 2)
    const right = x + width
    const bottom = y + height

    cr.newSubPath()
    cr.arc(right - clampedRadius, y + clampedRadius, clampedRadius, -Math.PI / 2, 0)
    cr.arc(right - clampedRadius, bottom - clampedRadius, clampedRadius, 0, Math.PI / 2)
    cr.arc(x + clampedRadius, bottom - clampedRadius, clampedRadius, Math.PI / 2, Math.PI)
    cr.arc(x + clampedRadius, y + clampedRadius, clampedRadius, Math.PI, (Math.PI * 3) / 2)
    cr.closePath()
}

function Workspaces() {
    const hyprland = AstalHyprland.get_default()
    const workspaces = createBinding(hyprland, 'workspaces')
    const focusedWorkspace = createBinding(hyprland, 'focusedWorkspace')

    const workspaceButtons = new Map<number, Gtk.Button>()
    const bubbleState: BubbleState = {
        visible: false,
        startX: 0,
        targetX: 0,
        startWidth: 0,
        targetWidth: 0,
        currentX: 0,
        currentWidth: 0,
        currentScaleY: 1,
        currentWidthBoost: 0,
    }

    let bubbleArea: Gtk.DrawingArea | null = null
    let bubbleAnimation: Adw.SpringAnimation | null = null
    let pendingSyncSourceId: number | null = null

    const queueBubbleDraw = () => {
        if (bubbleArea === null) {
            return
        }

        bubbleArea.queue_draw()
    }

    const getWorkspaceBounds = (workspaceId: number): WorkspaceBounds | null => {
        const button = workspaceButtons.get(workspaceId)

        if (button === undefined || button === null || bubbleArea === null) {
            return null
        }

        const [hasBounds, bounds] = button.compute_bounds(bubbleArea)

        if (hasBounds === false || bounds === null) {
            return null
        }

        return {
            x: bounds.get_x(),
            width: bounds.get_width(),
        }
    }

    const updateBubbleFrame = (progress: number) => {
        const clampedProgress = clamp(progress, 0, 1)
        const overshoot = Math.abs(progress - clampedProgress)
        const midSquash = Math.pow(Math.sin(Math.PI * clampedProgress), 1.2)
        const wobbleBoost = Math.min(overshoot * 0.3, 0.08)
        const widthBoost = midSquash * 10 + Math.min(overshoot * 36, 8)

        bubbleState.currentX = lerp(bubbleState.startX, bubbleState.targetX, clampedProgress)
        bubbleState.currentWidth = lerp(bubbleState.startWidth, bubbleState.targetWidth, clampedProgress)
        bubbleState.currentScaleY = clamp(1 - midSquash * 0.18 + wobbleBoost, 0.8, 1.08)
        bubbleState.currentWidthBoost = widthBoost

        queueBubbleDraw()
    }

    const ensureBubbleAnimation = () => {
        if (bubbleArea === null || bubbleAnimation !== null) {
            return
        }

        const target = Adw.CallbackAnimationTarget.new((value: number) => {
            updateBubbleFrame(value)
        })

        bubbleAnimation = Adw.SpringAnimation.new(
            bubbleArea,
            0,
            1,
            Adw.SpringParams.new(0.68, 1, 340),
            target,
        )
        bubbleAnimation.epsilon = 0.002
        bubbleAnimation.initialVelocity = 0
        bubbleAnimation.clamp = false
        bubbleAnimation.connect('done', () => {
            updateBubbleFrame(1)
        })
    }

    const snapBubbleToWorkspace = (workspaceId: number) => {
        const bounds = getWorkspaceBounds(workspaceId)

        if (bounds === null) {
            return
        }

        bubbleState.visible = true
        bubbleState.startX = bounds.x
        bubbleState.targetX = bounds.x
        bubbleState.startWidth = bounds.width
        bubbleState.targetWidth = bounds.width
        bubbleState.currentX = bounds.x
        bubbleState.currentWidth = bounds.width
        bubbleState.currentScaleY = 1
        bubbleState.currentWidthBoost = 0

        if (bubbleAnimation !== null) {
            bubbleAnimation.reset()
        }

        queueBubbleDraw()
    }

    const animateBubbleToWorkspace = (workspaceId: number) => {
        const bounds = getWorkspaceBounds(workspaceId)

        if (bounds === null) {
            return
        }

        if (bubbleState.visible === false) {
            snapBubbleToWorkspace(workspaceId)
            return
        }

        ensureBubbleAnimation()

        if (bubbleAnimation === null) {
            snapBubbleToWorkspace(workspaceId)
            return
        }

        bubbleState.visible = true
        bubbleState.startX = bubbleState.currentX
        bubbleState.targetX = bounds.x
        bubbleState.startWidth = bubbleState.currentWidth
        bubbleState.targetWidth = bounds.width
        bubbleState.currentScaleY = 1
        bubbleState.currentWidthBoost = 0

        bubbleAnimation.valueFrom = 0
        bubbleAnimation.valueTo = 1
        bubbleAnimation.initialVelocity = 0
        bubbleAnimation.play()
    }

    const scheduleBubbleSync = (animate: boolean) => {
        if (pendingSyncSourceId !== null) {
            GLib.source_remove(pendingSyncSourceId)
            pendingSyncSourceId = null
        }

        pendingSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingSyncSourceId = null

            const currentWorkspace = hyprland.focusedWorkspace

            if (currentWorkspace === null || currentWorkspace === undefined || currentWorkspace.id === 0) {
                return GLib.SOURCE_REMOVE
            }

            if (animate === true) {
                animateBubbleToWorkspace(currentWorkspace.id)
            } else {
                snapBubbleToWorkspace(currentWorkspace.id)
            }

            return GLib.SOURCE_REMOVE
        })
    }

    const drawBubble = (_area: Gtk.DrawingArea, cr: Cairo.Context, width: number, height: number) => {
        if (bubbleState.visible === false) {
            return
        }

        const bubbleWidth = Math.max(22, bubbleState.currentWidth + bubbleState.currentWidthBoost)
        const bubbleX = clamp(
            bubbleState.currentX - bubbleState.currentWidthBoost / 2,
            0,
            Math.max(0, width - bubbleWidth),
        )
        const bubbleHeight = Math.max(18, (height - 4) * bubbleState.currentScaleY)
        const bubbleY = (height - bubbleHeight) / 2
        const bubbleRadius = 4

        cr.save()
        appendRoundedRectangle(cr, bubbleX, bubbleY + 1, bubbleWidth, bubbleHeight, bubbleRadius)
        cr.setSourceRGBA(1, 1, 1, 0.1)
        cr.fill()

        appendRoundedRectangle(cr, bubbleX, bubbleY, bubbleWidth, bubbleHeight, bubbleRadius)
        cr.setSourceRGBA(1, 1, 1, 0.22)
        cr.fillPreserve()
        cr.setSourceRGBA(1, 1, 1, 0.32)
        cr.setLineWidth(1)
        cr.stroke()
        cr.restore()
    }

    const initBubbleArea = (area: Gtk.DrawingArea) => {
        bubbleArea = area
        area.set_draw_func(drawBubble)
        scheduleBubbleSync(false)

        const focusHandler = hyprland.connect('notify::focused-workspace', () => {
            scheduleBubbleSync(true)
        })

        const destroyHandler = area.connect('destroy', () => {
            hyprland.disconnect(focusHandler)

            if (pendingSyncSourceId !== null) {
                GLib.source_remove(pendingSyncSourceId)
                pendingSyncSourceId = null
            }

            if (bubbleAnimation !== null) {
                bubbleAnimation.reset()
                bubbleAnimation = null
            }

            area.disconnect(destroyHandler)
            bubbleArea = null
        })
    }

    const initWorkspaceButton = (button: Gtk.Button, workspace: AstalHyprland.Workspace) => {
        workspaceButtons.set(workspace.id, button)
        scheduleBubbleSync(false)

        const destroyHandler = button.connect('destroy', () => {
            workspaceButtons.delete(workspace.id)
            button.disconnect(destroyHandler)
            scheduleBubbleSync(false)
        })
    }

    return (
        <overlay $type="center">
            <box spacing={4} valign={Gtk.Align.CENTER}>
                <For each={workspaces((value: AstalHyprland.Workspace[]) => value.filter((ws) => ws.id !== 0).sort((a, b) => a.id - b.id))}>
                    {(workspace: AstalHyprland.Workspace) => (
                        <button
                            class={focusedWorkspace((currentWorkspace: AstalHyprland.Workspace) => {
                                if (currentWorkspace === undefined || currentWorkspace === null) {
                                    return 'workspace-item'
                                }

                                if (currentWorkspace.id === workspace.id) {
                                    return 'workspace-item workspace-item-active'
                                }

                                return 'workspace-item'
                            })}
                            $={(self) => initWorkspaceButton(self, workspace)}
                            onClicked={() => workspace.focus()}
                        >
                            <label label={workspace.name} />
                        </button>
                    )}
                </For>
            </box>
            <drawingarea
                $type="overlay"
                class="workspace-bubble-layer"
                hexpand
                vexpand
                canTarget={false}
                canFocus={false}
                focusable={false}
                onResize={() => scheduleBubbleSync(false)}
                $={(self) => initBubbleArea(self)}
            />
        </overlay>
    )
}
function Tray() {
    const tray = AstalTray.get_default()
    const items = createBinding(tray, 'items')

    const init = (button: Gtk.Button, item: AstalTray.TrayItem) => {
        const popover = Gtk.PopoverMenu.new_from_model(item.menuModel)
        popover.set_parent(button)

        if (item.actionGroup !== undefined && item.actionGroup !== null) {
            popover.insert_action_group('dbusmenu', item.actionGroup)
        }

        item.connect('notify::action-group', () => {
            popover.insert_action_group('dbusmenu', item.actionGroup)
        })

        const gesture = new Gtk.GestureClick()
        gesture.set_button(0)
        gesture.connect('pressed', (self, _nPress, x, y) => {
            const currentButton = self.get_current_button()
            
            if (currentButton === Gdk.BUTTON_PRIMARY) {
                self.set_state(Gtk.EventSequenceState.CLAIMED)
                popover.popdown()
                item.activate(x, y)
                return
            }
            if (currentButton === Gdk.BUTTON_SECONDARY) {
                self.set_state(Gtk.EventSequenceState.CLAIMED)
                popover.popup()
                return
            }
        })

        button.add_controller(gesture)
    }

    return (
        <box $type="center" spacing={4} class="with-dividers">
            <For each={items((value: AstalTray.TrayItem[]) => value.filter((item) => item.id !== null))}>
                {(item: AstalTray.TrayItem) => (
                    <button class="tray-item" $={(self) => init(self, item)} hasTooltip={true} tooltipText={item.title}>
                        <image gicon={createBinding(item, 'gicon')} pixelSize={20} />
                    </button>
                )}
            </For>
        </box>
    )
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
    const time = createPoll("", 1000, "date")

    const result = (
        <window
            visible
            name="hyprbobr-bar"
            namespace="hyprbobr-bar"
            class="bar"
            layer={Astal.Layer.BOTTOM}
            gdkmonitor={gdkmonitor}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={
                Astal.WindowAnchor.TOP |
                Astal.WindowAnchor.LEFT |
                Astal.WindowAnchor.RIGHT
            }
            application={app}
            marginTop={12}
            marginLeft={12}
            marginRight={12}
        >
            <centerbox class="layout">
                <button
                    $type="start"
                    class="logo"
                    hexpand={false}
                    halign={Gtk.Align.START}
                >
                    <image
                        $type="start"
                        file="./assets/zhopa.png"
                        halign={Gtk.Align.START}
                        pixelSize={32}
                        overflow={Gtk.Overflow.HIDDEN}
                    />
                </button>
                <Workspaces />
                <box $type="end" spacing={8} hexpand halign={Gtk.Align.END} class="with-dividers">
                    <Tray />
                    <menubutton class="time">
                        <label label={time} />
                        <popover>
                            <Gtk.Calendar />
                        </popover>
                    </menubutton>
                </box>
            </centerbox>
        </window>
    )
    return result
}
