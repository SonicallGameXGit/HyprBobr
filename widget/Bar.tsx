import app from 'ags/gtk4/app'
import { Astal, Gtk, Gdk } from 'ags/gtk4'
import { createPoll } from 'ags/time'
import { createBinding, For } from 'ags'
import AstalTray from 'gi://AstalTray'
import AstalHyprland from 'gi://AstalHyprland'
import Adw from 'gi://Adw'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import GioUnix from 'gi://GioUnix'
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

const desktopIconCache = new Map<string, Gio.Icon>()
let wmClassIndex: Map<string, GioUnix.DesktopAppInfo> | null = null

function isDesktopAppInfo(app: Gio.AppInfo): app is GioUnix.DesktopAppInfo {
    return 'get_startup_wm_class' in app
}

function getWmClassIndex(): Map<string, GioUnix.DesktopAppInfo> {
    if (wmClassIndex !== null) {
        return wmClassIndex
    }

    wmClassIndex = new Map()
    const allApps = Gio.AppInfo.get_all()
    for (const a of allApps) {
        if (isDesktopAppInfo(a)) {
            const wmClass = a.get_startup_wm_class()
            if (wmClass !== null && wmClass !== '') {
                wmClassIndex.set(wmClass.toLowerCase(), a)
            }
        }
    }

    return wmClassIndex
}

function lookupAppIcon(cls: string): Gio.Icon {
    const cached = desktopIconCache.get(cls)
    if (cached !== undefined) {
        return cached
    }

    const lower = cls.toLowerCase()
    let icon: Gio.Icon | null = null

    const wmApp = getWmClassIndex().get(lower)
    if (wmApp !== undefined) {
        icon = wmApp.get_icon()
    }

    if (icon === null) {
        const directApp = GioUnix.DesktopAppInfo.new(lower + '.desktop')
        if (directApp !== null) {
            icon = directApp.get_icon()
        }
    }

    const result = icon !== null ? icon : Gio.ThemedIcon.new(lower)
    desktopIconCache.set(cls, result)
    return result
}

function getMainClient(clients: AstalHyprland.Client[]): AstalHyprland.Client | null {
    if (clients.length === 0) {
        return null
    }

    const tiledClients = clients.filter((c) => c.floating === false)
    const pool = tiledClients.length > 0 ? tiledClients : clients

    return pool.reduce((best, current) => {
        return current.width * current.height > best.width * best.height ? current : best
    })
}

function getMainClientClass(clients: AstalHyprland.Client[]): string | null {
    const mainClient = getMainClient(clients)

    if (mainClient === null) {
        return null
    }

    const cls = mainClient.initialClass
    if (cls === null || cls === undefined || cls === '') {
        return null
    }

    return cls
}

function getClientDisplayName(client: AstalHyprland.Client): string {
    if (client.initialClass !== null && client.initialClass !== undefined && client.initialClass !== '') {
        return client.initialClass
    }

    if (client.class !== null && client.class !== undefined && client.class !== '') {
        return client.class
    }

    if (client.initialTitle !== null && client.initialTitle !== undefined && client.initialTitle !== '') {
        return client.initialTitle
    }

    if (client.title !== null && client.title !== undefined && client.title !== '') {
        return client.title
    }

    return 'Unknown app'
}

function getWorkspaceOtherAppsTooltip(workspace: AstalHyprland.Workspace): string | null {
    const clients = workspace.clients

    if (clients.length <= 1) {
        return null
    }

    const mainClient = getMainClient(clients)
    const mainAddress = mainClient !== null ? mainClient.address : null

    const otherClients = clients.filter((client) => {
        if (mainAddress === null) {
            return true
        }

        return client.address !== mainAddress
    })

    if (otherClients.length === 0) {
        return null
    }

    const lines = otherClients.map((client) => '- ' + getClientDisplayName(client))
    return ['Other apps in this workspace:', ...lines].join('\n')
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
    const workspaceIcons = new Map<number, Gtk.Image>()
    const workspaceMoreIndicators = new Map<number, Gtk.Image>()
    const workspaceById = new Map<number, AstalHyprland.Workspace>()
    const workspaceMainClass = new Map<number, string | null>()
    const clientNotifyHandlers = new Map<string, number[]>()
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
    let pendingIconSyncSourceId: number | null = null
    let periodicIconSyncSourceId: number | null = null

    const queueBubbleDraw = () => {
        if (bubbleArea === null) {
            return
        }

        bubbleArea.queue_draw()
    }

    const updateWorkspaceVisuals = (workspace: AstalHyprland.Workspace) => {
        const image = workspaceIcons.get(workspace.id)
        const button = workspaceButtons.get(workspace.id)
        const moreIndicator = workspaceMoreIndicators.get(workspace.id)

        const tooltipText = getWorkspaceOtherAppsTooltip(workspace)

        if (button !== undefined && button !== null) {
            if (tooltipText === null) {
                button.set_has_tooltip(false)
                button.set_tooltip_text(null)
            } else {
                button.set_tooltip_text(tooltipText)
                button.set_has_tooltip(true)
            }
        }

        if (moreIndicator !== undefined && moreIndicator !== null) {
            moreIndicator.set_visible(tooltipText !== null)
        }

        if (image === undefined || image === null) {
            return
        }

        const nextClass = getMainClientClass(workspace.clients)
        const previousClass = workspaceMainClass.get(workspace.id)

        if (previousClass !== undefined && previousClass === nextClass) {
            return
        }

        workspaceMainClass.set(workspace.id, nextClass)

        if (nextClass === null) {
            image.set_from_gicon(Gio.ThemedIcon.new('application-x-executable'))
            return
        }

        image.set_from_gicon(lookupAppIcon(nextClass))
    }

    const scheduleWorkspaceIconsSync = () => {
        if (pendingIconSyncSourceId !== null) {
            return
        }

        pendingIconSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingIconSyncSourceId = null

            for (const workspace of workspaceById.values()) {
                updateWorkspaceVisuals(workspace)
            }

            return GLib.SOURCE_REMOVE
        })
    }

    const watchClient = (client: AstalHyprland.Client) => {
        const key = client.address

        if (clientNotifyHandlers.has(key)) {
            return
        }

        const handlerIds = [
            client.connect('notify::width', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::height', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::floating', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::workspace', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::initial-class', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::class', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::mapped', () => scheduleWorkspaceIconsSync()),
            client.connect('notify::hidden', () => scheduleWorkspaceIconsSync()),
        ]

        clientNotifyHandlers.set(key, handlerIds)
    }

    const unwatchClientByAddress = (address: string) => {
        const handlerIds = clientNotifyHandlers.get(address)

        if (handlerIds === undefined) {
            return
        }

        const currentClient = hyprland.clients.find((c) => c.address === address)

        if (currentClient !== undefined && currentClient !== null) {
            for (const id of handlerIds) {
                currentClient.disconnect(id)
            }
        }

        clientNotifyHandlers.delete(address)
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
        scheduleWorkspaceIconsSync()

        for (const client of hyprland.clients) {
            watchClient(client)
        }

        const focusHandler = hyprland.connect('notify::focused-workspace', () => {
            scheduleBubbleSync(true)
        })
        const clientAddedHandler = hyprland.connect('client-added', (client: AstalHyprland.Client) => {
            watchClient(client)
            scheduleWorkspaceIconsSync()
        })
        const clientMovedHandler = hyprland.connect('client-moved', () => {
            scheduleWorkspaceIconsSync()
        })
        const floatingHandler = hyprland.connect('floating', () => {
            scheduleWorkspaceIconsSync()
        })
        const clientRemovedHandler = hyprland.connect('client-removed', (address: string) => {
            unwatchClientByAddress(address)
            scheduleWorkspaceIconsSync()
        })

        const destroyHandler = area.connect('destroy', () => {
            hyprland.disconnect(focusHandler)
            hyprland.disconnect(clientAddedHandler)
            hyprland.disconnect(clientMovedHandler)
            hyprland.disconnect(floatingHandler)
            hyprland.disconnect(clientRemovedHandler)

            if (pendingSyncSourceId !== null) {
                GLib.source_remove(pendingSyncSourceId)
                pendingSyncSourceId = null
            }

            if (pendingIconSyncSourceId !== null) {
                GLib.source_remove(pendingIconSyncSourceId)
                pendingIconSyncSourceId = null
            }

            if (periodicIconSyncSourceId !== null) {
                GLib.source_remove(periodicIconSyncSourceId)
                periodicIconSyncSourceId = null
            }

            for (const [address] of clientNotifyHandlers) {
                unwatchClientByAddress(address)
            }

            workspaceById.clear()
            workspaceIcons.clear()
            workspaceMoreIndicators.clear()
            workspaceMainClass.clear()

            if (bubbleAnimation !== null) {
                bubbleAnimation.reset()
                bubbleAnimation = null
            }

            area.disconnect(destroyHandler)
            bubbleArea = null
        })

        periodicIconSyncSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 350, () => {
            scheduleWorkspaceIconsSync()
            return GLib.SOURCE_CONTINUE
        })
    }

    const initWorkspaceButton = (button: Gtk.Button, workspace: AstalHyprland.Workspace) => {
        workspaceButtons.set(workspace.id, button)
        workspaceById.set(workspace.id, workspace)
        scheduleBubbleSync(false)
        scheduleWorkspaceIconsSync()

        const destroyHandler = button.connect('destroy', () => {
            workspaceButtons.delete(workspace.id)
            workspaceById.delete(workspace.id)
            workspaceMainClass.delete(workspace.id)
            button.disconnect(destroyHandler)
            scheduleBubbleSync(false)
        })
    }

    const initWorkspaceIcon = (image: Gtk.Image, workspace: AstalHyprland.Workspace) => {
        workspaceIcons.set(workspace.id, image)
        updateWorkspaceVisuals(workspace)

        const destroyHandler = image.connect('destroy', () => {
            workspaceIcons.delete(workspace.id)
            image.disconnect(destroyHandler)
        })
    }

    const initWorkspaceMoreIndicator = (image: Gtk.Image, workspace: AstalHyprland.Workspace) => {
        workspaceMoreIndicators.set(workspace.id, image)
        updateWorkspaceVisuals(workspace)

        const destroyHandler = image.connect('destroy', () => {
            workspaceMoreIndicators.delete(workspace.id)
            image.disconnect(destroyHandler)
        })
    }

    return (
        <overlay $type="center">
            <box spacing={4} valign={Gtk.Align.CENTER}>
                <For each={workspaces((value: AstalHyprland.Workspace[]) => value.filter((ws) => ws.id !== 0).sort((a, b) => a.id - b.id))}>
                    {(workspace: AstalHyprland.Workspace) => {
                        return (
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
                                onClicked={() => {
                                    const currentWorkspace = hyprland.focusedWorkspace

                                    if (currentWorkspace === null || currentWorkspace === undefined) {
                                        workspace.focus()
                                        return
                                    }

                                    if (currentWorkspace.id === workspace.id) {
                                        return
                                    }

                                    workspace.focus()
                                }}
                            >
                                <overlay class="workspace-icon-stack">
                                    <image
                                        gicon={Gio.ThemedIcon.new('application-x-executable')}
                                        $={(self) => initWorkspaceIcon(self, workspace)}
                                        pixelSize={20}
                                    />
                                    <image
                                        $type="overlay"
                                        class="workspace-more-indicator"
                                        gicon={Gio.ThemedIcon.new('application-x-executable')}
                                        halign={Gtk.Align.END}
                                        valign={Gtk.Align.END}
                                        pixelSize={16}
                                        visible={false}
                                        $={(self) => initWorkspaceMoreIndicator(self, workspace)}
                                    />
                                </overlay>
                            </button>
                        )
                    }}
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
