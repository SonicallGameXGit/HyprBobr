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
import { exec } from 'ags/process'
import { readFile, writeFile } from 'ags/file'

const HOME = GLib.get_home_dir()
const LAYOUT_FILE = `${HOME}/.config/hypr/keyboard-layouts.conf`

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

function getSecondaryClientClass(clients: AstalHyprland.Client[]): string | null {
    if (clients.length <= 1) {
        return null
    }

    const mainClient = getMainClient(clients)
    const mainAddress = mainClient !== null ? mainClient.address : null

    const rest = clients.filter((c) => c.address !== mainAddress)
    if (rest.length === 0) {
        return null
    }

    const secondary = rest.reduce((best, current) => {
        return current.width * current.height > best.width * best.height ? current : best
    })

    const cls = secondary.initialClass
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
    const workspaceDots = new Map<number, Gtk.Label>()
    const workspaceMainClass = new Map<number, string | null>()
    const workspaceSecondaryClass = new Map<number, string | null>()
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
    let pendingBoundsSyncSourceId: number | null = null
    let pendingIconSyncSourceId: number | null = null
    let periodicIconSyncSourceId: number | null = null
    const workspaceBoundsCache = new Map<number, WorkspaceBounds>()

    const queueBubbleDraw = () => {
        if (bubbleArea === null) {
            return
        }

        bubbleArea.queue_draw()
    }

    const updateWorkspaceVisuals = (workspaceId: number) => {
        const workspace = hyprland.workspaces.find((ws) => ws.id === workspaceId) ?? null
        const image = workspaceIcons.get(workspaceId)
        const dot = workspaceDots.get(workspaceId)
        const button = workspaceButtons.get(workspaceId)
        const moreIndicator = workspaceMoreIndicators.get(workspaceId)
        const hasWorkspace = workspace !== null

        if (dot !== undefined) {
            dot.set_visible(!hasWorkspace)
        }

        if (image !== undefined) {
            image.set_opacity(hasWorkspace ? 1 : 0)
        }

        if (hasWorkspace === false) {
            if (button !== undefined) {
                button.set_has_tooltip(false)
                button.set_tooltip_text(null)
            }

            if (moreIndicator !== undefined) {
                moreIndicator.set_visible(false)
            }

            workspaceMainClass.delete(workspaceId)
            workspaceSecondaryClass.delete(workspaceId)
            return
        }

        const tooltipText = getWorkspaceOtherAppsTooltip(workspace)

        if (button !== undefined) {
            if (tooltipText === null) {
                button.set_has_tooltip(false)
                button.set_tooltip_text(null)
            } else {
                button.set_tooltip_text(tooltipText)
                button.set_has_tooltip(true)
            }
        }

        if (moreIndicator !== undefined) {
            moreIndicator.set_visible(tooltipText !== null)
        }

        if (image === undefined) {
            return
        }

        const isEmpty = workspace.clients.length === 0
        const nextClass = getMainClientClass(workspace.clients)
        const nextSecondaryClass = getSecondaryClientClass(workspace.clients)
        const previousClass = workspaceMainClass.get(workspaceId)
        const previousSecondaryClass = workspaceSecondaryClass.get(workspaceId)

        if (isEmpty === false && previousClass !== undefined && previousClass === nextClass && previousSecondaryClass === nextSecondaryClass) {
            return
        }

        workspaceMainClass.set(workspaceId, nextClass)
        workspaceSecondaryClass.set(workspaceId, nextSecondaryClass)

        if (nextClass === null) {
            const isFocused = isEmpty &&
                hyprland.focusedWorkspace !== null &&
                hyprland.focusedWorkspace !== undefined &&
                hyprland.focusedWorkspace.id === workspaceId
            image.set_from_gicon(Gio.ThemedIcon.new(isFocused ? 'list-add-symbolic' : 'application-x-executable'))
        } else {
            image.set_from_gicon(lookupAppIcon(nextClass))
        }

        if (moreIndicator !== undefined) {
            if (nextSecondaryClass !== null) {
                moreIndicator.set_from_gicon(lookupAppIcon(nextSecondaryClass))
            } else {
                moreIndicator.set_from_gicon(Gio.ThemedIcon.new('application-x-executable'))
            }
        }
    }

    const scheduleWorkspaceIconsSync = () => {
        if (pendingIconSyncSourceId !== null) {
            return
        }

        pendingIconSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingIconSyncSourceId = null

            for (const workspaceId of workspaceButtons.keys()) {
                updateWorkspaceVisuals(workspaceId)
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
        return workspaceBoundsCache.get(workspaceId) ?? null
    }

    const recalculateAllBounds = () => {
        if (bubbleArea === null) {
            return
        }

        workspaceBoundsCache.clear()

        for (const [id, button] of workspaceButtons) {
            const [hasBounds, bounds] = button.compute_bounds(bubbleArea)

            if (hasBounds && bounds !== null) {
                workspaceBoundsCache.set(id, { x: bounds.get_x(), width: bounds.get_width() })
            }
        }
    }

    const scheduleRecalculateAndSnap = () => {
        if (pendingBoundsSyncSourceId !== null) {
            GLib.source_remove(pendingBoundsSyncSourceId)
            pendingBoundsSyncSourceId = null
        }

        pendingBoundsSyncSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pendingBoundsSyncSourceId = null
            recalculateAllBounds()

            const currentWorkspace = hyprland.focusedWorkspace

            if (currentWorkspace !== null && currentWorkspace !== undefined && currentWorkspace.id !== 0) {
                snapBubbleToWorkspace(currentWorkspace.id)
            }

            return GLib.SOURCE_REMOVE
        })
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
        scheduleRecalculateAndSnap()
        scheduleWorkspaceIconsSync()

        for (const client of hyprland.clients) {
            watchClient(client)
        }

        const focusHandler = hyprland.connect('notify::focused-workspace', () => {
            scheduleBubbleSync(true)
            scheduleWorkspaceIconsSync()
        })
        const workspacesChangedHandler = hyprland.connect('notify::workspaces', () => {
            scheduleWorkspaceIconsSync()
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
            hyprland.disconnect(workspacesChangedHandler)
            hyprland.disconnect(clientAddedHandler)
            hyprland.disconnect(clientMovedHandler)
            hyprland.disconnect(floatingHandler)
            hyprland.disconnect(clientRemovedHandler)

            if (pendingSyncSourceId !== null) {
                GLib.source_remove(pendingSyncSourceId)
                pendingSyncSourceId = null
            }

            if (pendingBoundsSyncSourceId !== null) {
                GLib.source_remove(pendingBoundsSyncSourceId)
                pendingBoundsSyncSourceId = null
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

            workspaceIcons.clear()
            workspaceMoreIndicators.clear()
            workspaceDots.clear()
            workspaceMainClass.clear()
            workspaceSecondaryClass.clear()
            workspaceBoundsCache.clear()

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

    const initSlotButton = (button: Gtk.Button, workspaceId: number) => {
        workspaceButtons.set(workspaceId, button)
        scheduleRecalculateAndSnap()

        const destroyHandler = button.connect('destroy', () => {
            workspaceButtons.delete(workspaceId)
            workspaceMainClass.delete(workspaceId)
            workspaceSecondaryClass.delete(workspaceId)
            button.disconnect(destroyHandler)
        })
    }

    const initSlotDot = (label: Gtk.Label, workspaceId: number) => {
        workspaceDots.set(workspaceId, label)
        label.set_visible(hyprland.workspaces.find((ws) => ws.id === workspaceId) === undefined)

        const destroyHandler = label.connect('destroy', () => {
            workspaceDots.delete(workspaceId)
            label.disconnect(destroyHandler)
        })
    }

    const initSlotIcon = (image: Gtk.Image, workspaceId: number) => {
        workspaceIcons.set(workspaceId, image)
        const hasWorkspace = hyprland.workspaces.find((ws) => ws.id === workspaceId) !== undefined
        image.set_opacity(hasWorkspace ? 1 : 0)

        const destroyHandler = image.connect('destroy', () => {
            workspaceIcons.delete(workspaceId)
            image.disconnect(destroyHandler)
        })
    }

    const initSlotMoreIndicator = (image: Gtk.Image, workspaceId: number) => {
        workspaceMoreIndicators.set(workspaceId, image)

        const destroyHandler = image.connect('destroy', () => {
            workspaceMoreIndicators.delete(workspaceId)
            image.disconnect(destroyHandler)
        })
    }

    return (
        <overlay $type="center">
            <box spacing={4} valign={Gtk.Align.CENTER}>
                <For each={workspaces((value: AstalHyprland.Workspace[]) => {
                    const realWorkspaces = value.filter((ws) => ws.id !== 0)
                    const maxId = realWorkspaces.length > 0 ? Math.max(...realWorkspaces.map((ws) => ws.id)) : 0
                    const displayMax = Math.max(10, maxId)
                    const allIds: number[] = []

                    for (let i = 1; i <= displayMax; i++) {
                        allIds.push(i)
                    }

                    return allIds
                })}>
                    {(workspaceId: number) => (
                        <button
                            class={focusedWorkspace((currentWorkspace: AstalHyprland.Workspace) => {
                                if (currentWorkspace === undefined || currentWorkspace === null) {
                                    return 'workspace-item'
                                }

                                if (currentWorkspace.id === workspaceId) {
                                    return 'workspace-item workspace-item-active'
                                }

                                return 'workspace-item'
                            })}
                            $={(self) => initSlotButton(self, workspaceId)}
                            onClicked={() => {
                                const currentWorkspace = hyprland.focusedWorkspace

                                if (currentWorkspace !== null && currentWorkspace !== undefined && currentWorkspace.id === workspaceId) {
                                    return
                                }

                                hyprland.dispatch('workspace', workspaceId.toString())
                            }}
                        >
                            <overlay class="workspace-icon-stack">
                                <image
                                    gicon={Gio.ThemedIcon.new('application-x-executable')}
                                    pixelSize={20}
                                    $={(self) => initSlotIcon(self, workspaceId)}
                                />
                                <label
                                    $type="overlay"
                                    label="•"
                                    halign={Gtk.Align.CENTER}
                                    valign={Gtk.Align.CENTER}
                                    $={(self) => initSlotDot(self, workspaceId)}
                                />
                                <image
                                    $type="overlay"
                                    class="workspace-more-indicator"
                                    gicon={Gio.ThemedIcon.new('application-x-executable')}
                                    halign={Gtk.Align.END}
                                    valign={Gtk.Align.END}
                                    pixelSize={16}
                                    visible={false}
                                    $={(self) => initSlotMoreIndicator(self, workspaceId)}
                                />
                            </overlay>
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
                onResize={() => scheduleRecalculateAndSnap()}
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

type KeyboardState = {
    name: string
    layouts: string[]
    activeKeymap: string
    activeCode: string
    activeIndex: number
}

const XKB_DISPLAY_HINTS: Record<string, string[]> = {
    us: ['english (us)', '(us)', 'american'],
    ru: ['russian'],
    de: ['german', 'deutsch'],
    fr: ['french', 'français'],
    gb: ['english (uk)', 'british', '(gb)'],
    ua: ['ukrainian'],
    pl: ['polish'],
    es: ['spanish', 'español'],
    it: ['italian'],
    pt: ['portuguese'],
    nl: ['dutch'],
    tr: ['turkish'],
    jp: ['japanese'],
    cn: ['chinese'],
    kr: ['korean'],
    ar: ['arabic'],
    cz: ['czech'],
    sk: ['slovak'],
    hu: ['hungarian'],
    ro: ['romanian'],
    bg: ['bulgarian'],
    hr: ['croatian'],
    sr: ['serbian'],
    fi: ['finnish'],
    se: ['swedish'],
    no: ['norwegian'],
    dk: ['danish'],
    il: ['hebrew'],
    gr: ['greek'],
    ge: ['georgian'],
    by: ['belarusian'],
    lt: ['lithuanian'],
    lv: ['latvian'],
    ee: ['estonian'],
}

function matchLayoutToCode(layouts: string[], activeKeymap: string): string {
    const lower = activeKeymap.toLowerCase()
    for (const code of layouts) {
        const hints = XKB_DISPLAY_HINTS[code.toLowerCase()]
        if (hints !== undefined && hints.some((h) => lower.includes(h))) {
            return code
        }
        if (lower.startsWith(code.toLowerCase())) {
            return code
        }
    }
    return layouts.length > 0 ? layouts[0] : ''
}

function codeToFlag(code: string): string {
    const lower = code.toLowerCase()
    const a = lower.charCodeAt(0) - 97
    const b = lower.charCodeAt(1) - 97
    if (a < 0 || a > 25 || b < 0 || b > 25) {
        return ''
    }
    return String.fromCodePoint(0x1F1E6 + a, 0x1F1E6 + b)
}

function langLabel(code: string): string {
    const flag = codeToFlag(code)
    const upper = code.toUpperCase()
    if (flag === '') {
        return upper
    }
    return flag/*  + ' ' + upper */
}

// First term is used as display name in the picker. Rest are searchable aliases.
const LANG_INFO: Record<string, string[]> = {
    af: ['Afrikaans', 'South Africa', 'Suid-Afrika'],
    al: ['Albanian', 'Albania', 'Shqipëri', 'Shqip'],
    am: ['Armenian', 'Armenia', 'Հայաստան', 'Հայերեն'],
    ao: ['Angolan Keyboard', 'Angola'],
    ara: ['Arabic', 'العربية', 'عربي'],
    ar: ['Arabic (AR)', 'العربية'],
    at: ['German (Austria)', 'Austria', 'Österreich', 'Deutsch'],
    az: ['Azerbaijani', 'Azerbaijan', 'Azərbaycan', 'Azərbaycanca'],
    ba: ['Bosnian', 'Bosnia', 'Bosna', 'Bosanski'],
    bd: ['Bangla (Bangladesh)', 'Bangladesh', 'বাংলাদেশ', 'বাংলা'],
    be: ['Belgian', 'Belgium', 'Belgique', 'België', 'Belgien'],
    bg: ['Bulgarian', 'Bulgaria', 'България', 'Български'],
    brai: ['Braille'],
    br: ['Portuguese (Brazil)', 'Brazil', 'Brasil', 'Português'],
    bt: ['Dzongkha', 'Bhutan', 'འབྲུག'],
    bw: ['Tswana (Botswana)', 'Botswana'],
    by: ['Belarusian', 'Belarus', 'Беларусь', 'Беларуская'],
    ca: ['French (Canada)', 'Canada', 'Canadien', 'Français'],
    cd: ['French (DR Congo)', 'Congo'],
    ch: ['German (Switzerland)', 'Switzerland', 'Schweiz', 'Suisse', 'Svizzera'],
    cm: ['Cameroon Multilingual'],
    cn: ['Chinese', 'China', '中国', '中文', '汉语', '普通话'],
    hr: ['Croatian', 'Croatia', 'Hrvatska', 'Hrvatski'],
    cz: ['Czech', 'Czechia', 'Česko', 'Čeština'],
    dk: ['Danish', 'Denmark', 'Danmark', 'Dansk'],
    ee: ['Estonian', 'Estonia', 'Eesti'],
    eg: ['Arabic (Egypt)', 'Egypt', 'مصر'],
    epo: ['Esperanto'],
    es: ['Spanish', 'Spain', 'España', 'Español'],
    et: ['Amharic', 'Ethiopia', 'ኢትዮጵያ', 'አማርኛ'],
    eu: ['Basque'],
    fi: ['Finnish', 'Finland', 'Suomi'],
    fo: ['Faroese', 'Faroe Islands', 'Færøerne'],
    fr: ['French', 'France', 'Français'],
    gb: ['English (UK)', 'United Kingdom', 'Britain', 'England'],
    ge: ['Georgian', 'Georgia', 'საქართველო', 'ქართული'],
    gh: ['Ghanaian', 'Ghana'],
    gn: ['Guinean Keyboard'],
    gr: ['Greek', 'Greece', 'Ελλάδα', 'Ελληνικά'],
    hr2: ['Croatian (variant)', 'Croatia', 'Hrvatska'],
    hu: ['Hungarian', 'Hungary', 'Magyarország', 'Magyar'],
    id: ['Indonesian', 'Indonesia', 'Bahasa Indonesia'],
    ie: ['Irish', 'Ireland', 'Éire', 'Gaeilge'],
    il: ['Hebrew', 'Israel', 'ישראל', 'עברית'],
    in: ['Indian', 'India', 'भारत', 'हिन्दी'],
    iq: ['Arabic (Iraq)', 'Iraq', 'العراق'],
    ir: ['Persian', 'Iran', 'ایران', 'فارسی'],
    is: ['Icelandic', 'Iceland', 'Ísland', 'Íslenska'],
    it: ['Italian', 'Italy', 'Italia', 'Italiano'],
    jp: ['Japanese', 'Japan', '日本', '日本語'],
    ke: ['Swahili (Kenya)', 'Kenya'],
    kg: ['Kyrgyz', 'Kyrgyzstan', 'Кыргызстан', 'Кыргызча'],
    kh: ['Khmer', 'Cambodia', 'កម្ពុជា'],
    kr: ['Korean', 'South Korea', '한국', '한국어'],
    kz: ['Kazakh', 'Kazakhstan', 'Қазақстан', 'Қазақша'],
    la: ['Lao', 'Laos', 'ລາວ'],
    latam: ['Spanish (Latin America)', 'Latin America', 'Latinoamérica'],
    lb: ['Luxembourgish', 'Luxembourg', 'Lëtzebuerg'],
    lk: ['Sinhala', 'Sri Lanka', 'ශ්‍රී ලංකා', 'සිංහල'],
    lt: ['Lithuanian', 'Lithuania', 'Lietuva', 'Lietuvių'],
    lv: ['Latvian', 'Latvia', 'Latvija', 'Latviešu'],
    ma: ['Arabic (Morocco)', 'Morocco', 'المغرب'],
    mao: ['Māori', 'New Zealand'],
    me: ['Montenegrin', 'Montenegro', 'Crna Gora'],
    mk: ['Macedonian', 'North Macedonia', 'Македонија', 'Македонски'],
    ml: ['Bambara', 'Mali'],
    mm: ['Burmese', 'Myanmar', 'မြန်မာ'],
    mn: ['Mongolian', 'Mongolia', 'Монгол', 'Монгол Улс'],
    mt: ['Maltese', 'Malta', 'Malti'],
    mv: ['Dhivehi', 'Maldives', 'ދިވެހި'],
    my: ['Malay', 'Malaysia', 'Malaysia'],
    ng: ['Nigerian', 'Nigeria', 'Hausa', 'Yoruba', 'Igbo'],
    nl: ['Dutch', 'Netherlands', 'Nederland', 'Nederlands'],
    no: ['Norwegian', 'Norway', 'Norge', 'Norsk'],
    np: ['Nepali', 'Nepal', 'नेपाल', 'नेपाली'],
    ph: ['Filipino', 'Philippines', 'Pilipinas'],
    pk: ['Urdu', 'Pakistan', 'پاکستان', 'اردو'],
    pl: ['Polish', 'Poland', 'Polska', 'Polski'],
    pt: ['Portuguese', 'Portugal', 'Português'],
    ro: ['Romanian', 'Romania', 'România', 'Română'],
    rs: ['Serbian', 'Serbia', 'Србија', 'Српски'],
    ru: ['Russian', 'Russia', 'Россия', 'Русский', 'Русский язык'],
    se: ['Swedish', 'Sweden', 'Sverige', 'Svenska'],
    si: ['Slovenian', 'Slovenia', 'Slovenija', 'Slovenščina'],
    sk: ['Slovak', 'Slovakia', 'Slovensko', 'Slovenčina'],
    sn: ['Wolof', 'Senegal'],
    so: ['Somali', 'Somalia'],
    sq: ['Albanian'],
    sr: ['Serbian (variant)', 'Serbia', 'Србија', 'Српски'],
    sy: ['Arabic (Syria)', 'Syria', 'سوريا'],
    th: ['Thai', 'Thailand', 'ไทย', 'ประเทศไทย'],
    tj: ['Tajik', 'Tajikistan', 'Тоҷикистон', 'Тоҷикӣ'],
    tm: ['Turkmen', 'Turkmenistan', 'Türkmenistan'],
    tr: ['Turkish', 'Turkey', 'Türkiye', 'Türkçe'],
    tw: ['Traditional Chinese', 'Taiwan', '台灣', '繁體中文'],
    tz: ['Swahili (Tanzania)', 'Tanzania'],
    ua: ['Ukrainian', 'Ukraine', 'Україна', 'Українська'],
    us: ['English (US)', 'United States', 'America', 'American English'],
    uz: ['Uzbek', 'Uzbekistan', 'Oʻzbekiston', 'Oʻzbek'],
    vn: ['Vietnamese', 'Vietnam', 'Việt Nam', 'Tiếng Việt'],
    za: ['South African English', 'South Africa'],
}

function langSearchTerms(code: string): string[] {
    const lower = code.toLowerCase()
    const info = LANG_INFO[lower]
    const terms = [lower, ...(info !== undefined ? info : [])]
    return terms.map((t: string) => t.toLowerCase())
}

function langDisplayName(code: string): string {
    const lower = code.toLowerCase()
    const info = LANG_INFO[lower]
    if (info !== undefined && info.length > 0) {
        return info[0]
    }
    return code.toUpperCase()
}

function fetchKeyboardState(): KeyboardState | null {
    try {
        const [ok, stdout] = GLib.spawn_command_line_sync('hyprctl -j devices')
        if (!ok || stdout === null) {
            return null
        }
        const text = new TextDecoder().decode(stdout)
        const data = JSON.parse(text) as Record<string, unknown>
        const keyboards = Array.isArray(data.keyboards) ? (data.keyboards as unknown[]) : []
        const mainKb = keyboards.find((kb) => {
            if (typeof kb !== 'object' || kb === null) {
                return false
            }
            return (kb as Record<string, unknown>).main === true
        }) ?? (keyboards.length > 0 ? keyboards[0] : undefined)
        if (mainKb === undefined || mainKb === null || typeof mainKb !== 'object') {
            return null
        }
        const kb = mainKb as Record<string, unknown>
        const layoutStr = typeof kb.layout === 'string' ? kb.layout : ''
        const layouts = layoutStr.split(',').map((l: string) => l.trim()).filter((l: string) => l !== '')
        const activeKeymap = typeof kb.active_keymap === 'string' ? kb.active_keymap : ''
        const name = typeof kb.name === 'string' ? kb.name : ''
        const activeIndex = typeof kb.active_layout_index === 'number' ? kb.active_layout_index : 0
        const activeCode = layouts[activeIndex] ?? (layouts[0] ?? '')
        return { name, layouts, activeKeymap, activeCode, activeIndex }
    } catch {
        return null
    }
}

function fetchAllLayouts(): string[] {
    try {
        const [ok, stdout] = GLib.spawn_command_line_sync('localectl list-x11-keymap-layouts')
        if (!ok || stdout === null) {
            return []
        }
        const text = new TextDecoder().decode(stdout)
        return text.split('\n').map((l: string) => l.trim()).filter((l: string) => l !== '')
    } catch {
        return []
    }
}

function readLayoutFileLayouts(): string[] {
    try {
        const content = readFile(LAYOUT_FILE)
        const match = content.match(/kb_layout\s*=\s*([^\n}]+)/)
        if (match === null || match[1] === undefined) {
            return []
        }
        return match[1].split(',').map((l: string) => l.trim()).filter((l: string) => l !== '')
    } catch {
        return []
    }
}

function openAutoResolverDialog(layouts: string[], onFixed: (newLayouts: string[]) => void) {
    const resolverDialog = new Adw.Dialog()
    resolverDialog.contentWidth = 320
    resolverDialog.contentHeight = 400

    type RowMeta = { row: Gtk.ListBoxRow, code: string, check: Gtk.CheckButton }
    const rows: RowMeta[] = []

    let fixBtn: Gtk.Button | null = null

    const updateFixBtn = () => {
        if (fixBtn === null) {
            return
        }
        const checkedCount = rows.filter((m) => m.check.active).length
        fixBtn.sensitive = checkedCount <= 4
    }

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })

    const header = new Gtk.Label({ label: `Too many layouts (${layouts.length}/4) — remove some:` })
    header.halign = Gtk.Align.START
    header.marginStart = 12
    header.marginEnd = 12
    header.marginTop = 12
    header.marginBottom = 8
    content.append(header)

    const listBox = new Gtk.ListBox()
    listBox.selectionMode = Gtk.SelectionMode.NONE
    listBox.add_css_class('lang-manager-list')

    for (const code of layouts) {
        const isUs = code.toLowerCase() === 'us'
        const row = new Gtk.ListBoxRow()
        row.set_activatable(!isUs)
        const rowBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
        rowBox.marginStart = 10
        rowBox.marginEnd = 10
        rowBox.marginTop = 4
        rowBox.marginBottom = 4
        const flag = codeToFlag(code)
        if (flag !== '') {
            rowBox.append(new Gtk.Label({ label: flag }))
        }
        const nameLbl = new Gtk.Label({ label: langDisplayName(code) })
        nameLbl.halign = Gtk.Align.START
        nameLbl.hexpand = true
        rowBox.append(nameLbl)
        const check = new Gtk.CheckButton()
        check.active = true
        check.sensitive = !isUs
        check.connect('toggled', () => { updateFixBtn() })
        rowBox.append(check)
        row.set_child(rowBox)
        listBox.append(row)
        rows.push({ row, code, check })
    }

    listBox.connect('row-activated', (_lb: Gtk.ListBox, activatedRow: Gtk.ListBoxRow) => {
        const meta = rows.find((m) => m.row === activatedRow)
        if (meta === undefined) {
            return
        }
        meta.check.active = !meta.check.active
    })

    const scrolled = new Gtk.ScrolledWindow()
    scrolled.vexpand = true
    scrolled.set_child(listBox)
    content.append(scrolled)

    const sep = new Gtk.Separator()
    content.append(sep)

    fixBtn = new Gtk.Button({ label: 'Fix' })
    fixBtn.add_css_class('suggested-action')
    fixBtn.sensitive = false
    fixBtn.connect('clicked', () => {
        const checked = rows.filter((m) => m.check.active).map((m) => m.code.toLowerCase())
        const others = checked.filter((c) => c !== 'us')
        onFixed(['us', ...others])
        resolverDialog.force_close()
    })

    const btnRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    btnRow.halign = Gtk.Align.END
    btnRow.marginTop = 8
    btnRow.marginBottom = 8
    btnRow.marginStart = 8
    btnRow.marginEnd = 8
    btnRow.append(fixBtn)
    content.append(btnRow)

    resolverDialog.set_child(content)
    resolverDialog.present(app.get_active_window())
}

function openLanguageManagerDialog(
    parent: Gtk.Widget,
    currentLayouts: string[],
    onApply: (newLayouts: string[]) => void
) {
    const allLayouts = fetchAllLayouts()
    const initial = currentLayouts.map((l: string) => l.toLowerCase())
    if (!initial.includes('us')) {
        initial.unshift('us')
    }
    const originalSet = new Set(initial)
    let copyList: string[] = [...initial]
    let syncing = false

    let applyBtn: Gtk.Button | null = null

    const updateApplyLabel = () => {
        if (applyBtn === null) {
            return
        }
        const copySet = new Set(copyList)
        const added = [...copySet].filter((c) => !originalSet.has(c)).length
        const removed = [...originalSet].filter((c) => !copySet.has(c)).length
        const parts: string[] = []
        if (added > 0) {
            parts.push(`+${added}`)
        }
        if (removed > 0) {
            parts.push(`-${removed}`)
        }
        applyBtn.label = parts.length > 0 ? `Apply (${parts.join(' ')})` : 'Apply'
    }

    const dialog = new Adw.Dialog()
    dialog.contentWidth = 360
    dialog.contentHeight = 520

    const searchEntry = new Gtk.SearchEntry()
    searchEntry.placeholderText = 'Search...'
    searchEntry.marginTop = 8
    searchEntry.marginStart = 8
    searchEntry.marginEnd = 8
    searchEntry.marginBottom = 4

    const listBox = new Gtk.ListBox()
    listBox.selectionMode = Gtk.SelectionMode.NONE
    listBox.add_css_class('lang-manager-list')

    type RowMeta = { row: Gtk.ListBoxRow, code: string, check: Gtk.CheckButton }
    const rows: RowMeta[] = []

    const syncCheckboxesToCopyList = () => {
        syncing = true
        for (const { code, check } of rows) {
            check.active = copyList.includes(code.toLowerCase())
        }
        syncing = false
        updateApplyLabel()
    }

    const openResolverDialog = (newCode: string) => {
        const resolverDialog = new Adw.Dialog()
        resolverDialog.contentWidth = 320
        resolverDialog.contentHeight = 380

        type ResolverRowMeta = { row: Gtk.ListBoxRow, code: string, check: Gtk.CheckButton }
        const resolverRows: ResolverRowMeta[] = []

        let resolverFixBtn: Gtk.Button | null = null

        const updateResolverFixBtn = () => {
            if (resolverFixBtn === null) {
                return
            }
            // existing checked items + newCode itself must be <= 4
            const checkedCount = resolverRows.filter((m) => m.check.active).length
            resolverFixBtn.sensitive = checkedCount + 1 <= 4
        }

        const resolverContent = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })

        const addingHeader = new Gtk.Label({ label: 'Too many layouts — adding:' })
        addingHeader.halign = Gtk.Align.START
        addingHeader.marginStart = 12
        addingHeader.marginEnd = 12
        addingHeader.marginTop = 12
        addingHeader.marginBottom = 4
        resolverContent.append(addingHeader)

        const newLangBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
        newLangBox.marginStart = 12
        newLangBox.marginEnd = 12
        newLangBox.marginTop = 0
        newLangBox.marginBottom = 10
        const newFlag = codeToFlag(newCode)
        if (newFlag !== '') {
            newLangBox.append(new Gtk.Label({ label: newFlag }))
        }
        const newNameLbl = new Gtk.Label({ label: langDisplayName(newCode) })
        newNameLbl.halign = Gtk.Align.START
        newLangBox.append(newNameLbl)
        resolverContent.append(newLangBox)

        const sep1 = new Gtk.Separator()
        resolverContent.append(sep1)

        const removeHeader = new Gtk.Label({ label: 'Remove one to make room:' })
        removeHeader.halign = Gtk.Align.START
        removeHeader.marginStart = 12
        removeHeader.marginEnd = 12
        removeHeader.marginTop = 8
        removeHeader.marginBottom = 4
        resolverContent.append(removeHeader)

        const resolverListBox = new Gtk.ListBox()
        resolverListBox.selectionMode = Gtk.SelectionMode.NONE
        resolverListBox.add_css_class('lang-manager-list')

        for (const code of copyList.filter((c) => c !== newCode)) {
            const isUs = code === 'us'
            const row = new Gtk.ListBoxRow()
            row.set_activatable(!isUs)
            const rowBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
            rowBox.marginStart = 10
            rowBox.marginEnd = 10
            rowBox.marginTop = 4
            rowBox.marginBottom = 4
            const flag = codeToFlag(code)
            if (flag !== '') {
                rowBox.append(new Gtk.Label({ label: flag }))
            }
            const nameLbl = new Gtk.Label({ label: langDisplayName(code) })
            nameLbl.halign = Gtk.Align.START
            nameLbl.hexpand = true
            rowBox.append(nameLbl)
            const check = new Gtk.CheckButton()
            check.active = true
            check.sensitive = !isUs
            check.connect('toggled', () => { updateResolverFixBtn() })
            rowBox.append(check)
            row.set_child(rowBox)
            resolverListBox.append(row)
            resolverRows.push({ row, code, check })
        }

        resolverListBox.connect('row-activated', (_lb: Gtk.ListBox, activatedRow: Gtk.ListBoxRow) => {
            const meta = resolverRows.find((m) => m.row === activatedRow)
            if (meta === undefined) {
                return
            }
            meta.check.active = !meta.check.active
        })

        const resolverScrolled = new Gtk.ScrolledWindow()
        resolverScrolled.vexpand = true
        resolverScrolled.set_child(resolverListBox)
        resolverContent.append(resolverScrolled)

        const sep2 = new Gtk.Separator()
        resolverContent.append(sep2)

        const cancelResolverBtn = new Gtk.Button({ label: 'Cancel' })
        cancelResolverBtn.connect('clicked', () => {
            copyList = copyList.filter((c) => c !== newCode)
            syncCheckboxesToCopyList()
            resolverDialog.force_close()
        })

        resolverFixBtn = new Gtk.Button({ label: 'Fix' })
        resolverFixBtn.add_css_class('suggested-action')
        resolverFixBtn.sensitive = false
        resolverFixBtn.connect('clicked', () => {
            const toRemove = new Set(resolverRows.filter((m) => !m.check.active).map((m) => m.code))
            copyList = copyList.filter((c) => !toRemove.has(c))
            syncCheckboxesToCopyList()
            resolverDialog.force_close()
        })

        const resolverBtnRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
        resolverBtnRow.halign = Gtk.Align.END
        resolverBtnRow.marginTop = 8
        resolverBtnRow.marginBottom = 8
        resolverBtnRow.marginStart = 8
        resolverBtnRow.marginEnd = 8
        resolverBtnRow.append(cancelResolverBtn)
        resolverBtnRow.append(resolverFixBtn)
        resolverContent.append(resolverBtnRow)

        resolverDialog.set_child(resolverContent)
        resolverDialog.present(app.get_active_window())
    }

    for (const code of allLayouts) {
        const isUs = code.toLowerCase() === 'us'
        const row = new Gtk.ListBoxRow()
        row.set_activatable(!isUs)
        const rowBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
        rowBox.marginStart = 10
        rowBox.marginEnd = 10
        rowBox.marginTop = 4
        rowBox.marginBottom = 4

        const flag = codeToFlag(code)
        if (flag !== '') {
            const flagLbl = new Gtk.Label({ label: flag })
            rowBox.append(flagLbl)
        }

        const displayName = langDisplayName(code)
        const nameLbl = new Gtk.Label({ label: displayName })
        nameLbl.halign = Gtk.Align.START
        nameLbl.hexpand = true
        rowBox.append(nameLbl)

        const check = new Gtk.CheckButton()
        check.active = copyList.includes(code.toLowerCase())
        check.sensitive = !isUs
        check.connect('toggled', () => {
            if (syncing) {
                return
            }
            const lower = code.toLowerCase()
            if (check.active) {
                if (!copyList.includes(lower)) {
                    copyList = [...copyList, lower]
                }
                if (copyList.length > 4) {
                    syncing = true
                    check.active = false
                    syncing = false
                    openResolverDialog(lower)
                }
            } else {
                copyList = copyList.filter((c) => c !== lower)
            }
            updateApplyLabel()
        })
        rowBox.append(check)

        row.set_child(rowBox)
        listBox.append(row)
        rows.push({ row, code, check })
    }

    listBox.connect('row-activated', (_lb: Gtk.ListBox, activatedRow: Gtk.ListBoxRow) => {
        const meta = rows.find((r) => r.row === activatedRow)
        if (meta === undefined) {
            return
        }
        meta.check.active = !meta.check.active
    })

    const scrolled = new Gtk.ScrolledWindow()
    scrolled.vexpand = true
    scrolled.hexpand = true
    scrolled.set_child(listBox)

    const cancelBtn = new Gtk.Button({ label: 'Cancel' })
    cancelBtn.connect('clicked', () => {
        dialog.force_close()
    })

    applyBtn = new Gtk.Button({ label: 'Apply' })
    applyBtn.add_css_class('suggested-action')
    applyBtn.connect('clicked', () => {
        const others = copyList.filter((c) => c !== 'us')
        const newLayouts = ['us', ...others]
        onApply(newLayouts)
        dialog.force_close()
    })

    updateApplyLabel()

    let filterActive = false

    const applyRowFilter = () => {
        const q = searchEntry.text.toLowerCase()
        for (const { row, code } of rows) {
            const matchesSearch = q === '' || langSearchTerms(code).some((t) => t.includes(q))
            const matchesFilter = !filterActive || originalSet.has(code.toLowerCase())
            row.visible = matchesSearch && matchesFilter
        }
    }

    searchEntry.connect('search-changed', () => { applyRowFilter() })

    const filterBtn = new Gtk.ToggleButton()
    filterBtn.add_css_class('lang-filter-btn')
    filterBtn.set_child(new Gtk.Image({ iconName: 'format-justify-fill-symbolic', pixelSize: 16 }))
    filterBtn.connect('toggled', () => {
        filterActive = filterBtn.active
        applyRowFilter()
    })

    const btnRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    btnRow.marginTop = 8
    btnRow.marginBottom = 8
    btnRow.marginStart = 8
    btnRow.marginEnd = 8

    const btnLeft = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 })
    btnLeft.halign = Gtk.Align.START
    btnLeft.hexpand = true
    btnLeft.append(filterBtn)

    const btnRight = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 })
    btnRight.halign = Gtk.Align.END
    btnRight.append(cancelBtn)
    btnRight.append(applyBtn)

    btnRow.append(btnLeft)
    btnRow.append(btnRight)

    const sep = new Gtk.Separator()

    const content = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL })
    content.append(searchEntry)
    content.append(scrolled)
    content.append(sep)
    content.append(btnRow)

    dialog.set_child(content)
    dialog.present(app.get_active_window())
}

function LanguageIndicator() {
    const hyprland = AstalHyprland.get_default()
    let label: Gtk.Label | null = null
    let menuBtn: Gtk.MenuButton | null = null
    let popoverBox: Gtk.Box | null = null
    const initialKbState = fetchKeyboardState()
    let currentLayouts: string[] = initialKbState !== null ? initialKbState.layouts : []
    let activeCode = initialKbState !== null ? initialKbState.activeCode : (currentLayouts[0] ?? '')
    const initialLabel = langLabel(activeCode)

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        const fileLayouts = readLayoutFileLayouts()
        if (fileLayouts.length > 4) {
            openAutoResolverDialog(fileLayouts, (fixed) => {
                currentLayouts = fixed
                writeFile(LAYOUT_FILE, `input {\n    kb_layout = ${fixed.join(',')}\n}`)
                exec('hyprctl reload')
            })
        }
        return GLib.SOURCE_REMOVE
    })

    const refreshLayouts = () => {
        const state = fetchKeyboardState()
        if (state === null) {
            return
        }
        currentLayouts = state.layouts
        activeCode = state.activeCode
    }

    const rebuildPopoverContent = () => {
        refreshLayouts()
        if (label !== null) {
            label.set_label(langLabel(activeCode))
        }
        if (popoverBox === null) {
            return
        }
        const box = popoverBox

        let child = box.get_first_child()
        while (child !== null) {
            const next = child.get_next_sibling()
            box.remove(child)
            child = next
        }

        currentLayouts.forEach((code, index) => {
            const btn = new Gtk.Button()
            btn.hexpand = true
            btn.add_css_class('lang-item')
            if (code.toLowerCase() === activeCode.toLowerCase()) {
                btn.add_css_class('lang-item-active')
            }
            const itemBox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 })
            itemBox.hexpand = true
            itemBox.halign = Gtk.Align.START
            const flagLbl = new Gtk.Label({ label: langLabel(code) })
            itemBox.append(flagLbl)
            const nameLbl = new Gtk.Label({ label: langDisplayName(code) })
            nameLbl.add_css_class('lang-item-name')
            itemBox.append(nameLbl)
            btn.set_child(itemBox)
            btn.connect('clicked', () => {
                exec(`hyprctl switchxkblayout all ${index}`)
                if (menuBtn !== null) {
                    menuBtn.popdown()
                }
            })
            box.append(btn)
        })

        const addBtn = new Gtk.Button()
        addBtn.hexpand = true
        addBtn.add_css_class('lang-add-btn')
        const addLbl = new Gtk.Label({ label: '+' })
        addLbl.halign = Gtk.Align.CENTER
        addLbl.hexpand = true
        addBtn.set_child(addLbl)
        addBtn.connect('clicked', () => {
            openLanguageManagerDialog(addBtn, currentLayouts, (newLayouts) => {
                currentLayouts = newLayouts
                const layoutStr = newLayouts.join(',')
                writeFile(LAYOUT_FILE, `input {\n    kb_layout = ${layoutStr}\n}`)
                exec('hyprctl reload')
                rebuildPopoverContent()
            })
            if (menuBtn !== null) {
                menuBtn.popdown()
            }
        })
        box.append(addBtn)
    }

    hyprland.connect('keyboard-layout', () => {
        if (label === null) {
            return
        }
        const state = fetchKeyboardState()
        if (state === null) {
            return
        }
        currentLayouts = state.layouts
        activeCode = state.activeCode
        label.set_label(langLabel(activeCode))
        const fileLayouts = readLayoutFileLayouts()
        if (fileLayouts.length > 4) {
            openAutoResolverDialog(fileLayouts, (fixed) => {
                currentLayouts = fixed
                writeFile(LAYOUT_FILE, `input {\n    kb_layout = ${fixed.join(',')}\n}`)
                exec('hyprctl reload')
            })
        }
    })

    return (
        <menubutton
            class="language"
            $={(self: Gtk.MenuButton) => { menuBtn = self }}
        >
            <label
                class="language-label"
                label={initialLabel}
                halign={Gtk.Align.CENTER}
                $={(self: Gtk.Label) => { label = self }}
            />
            <popover
                class="hyprbobr-lang-popover"
                $={(self: Gtk.Popover) => {
                    self.connect('notify::visible', () => {
                        if (self.visible) {
                            rebuildPopoverContent()
                        }
                    })
                }}
            >
                <box
                    orientation={Gtk.Orientation.VERTICAL}
                    spacing={2}
                    $={(self: Gtk.Box) => {
                        popoverBox = self
                        rebuildPopoverContent()
                    }}
                />
            </popover>
        </menubutton>
    )
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
    const time = createPoll('', 1000, 'date "+%a, %b %-d  %-I:%M %p"')

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
                    <LanguageIndicator />
                    <menubutton class="time">
                        <label class="time-label" label={time} />
                        <popover class="hyprbobr-time-popover">
                            <Gtk.Calendar showWeekNumbers={false} />
                        </popover>
                    </menubutton>
                </box>
            </centerbox>
        </window>
    )
    return result
}
