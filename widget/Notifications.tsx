import { Astal, Gtk } from 'ags/gtk4'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import GioUnix from 'gi://GioUnix'
import Notifd from 'gi://AstalNotifd'
import { notifications } from '../service/notifications'
import { For } from 'gnim'

function resolveAppIcon(appIcon: string, desktopEntry: string): { isPath: boolean, value: string } | null {
    if (appIcon !== '' && appIcon !== null && appIcon !== undefined) {
        if (appIcon.startsWith('/')) {
            return { isPath: true, value: appIcon }
        }
        return { isPath: false, value: appIcon }
    }
    const entryId = desktopEntry !== '' && desktopEntry !== null && desktopEntry !== undefined
        ? desktopEntry
        : null
    if (entryId !== null) {
        const candidates = [
            entryId,
            entryId + '.desktop',
            entryId.toLowerCase(),
            entryId.toLowerCase() + '.desktop',
        ]
        for (const candidate of candidates) {
            const info = GioUnix.DesktopAppInfo.new(candidate)
            if (info !== null) {
                const icon = info.get_icon()
                if (icon !== null) {
                    if (icon instanceof Gio.ThemedIcon) {
                        const names = icon.get_names()
                        if (names.length > 0) {
                            return { isPath: false, value: names[0] }
                        }
                    } else if (icon instanceof Gio.FileIcon) {
                        const path = icon.file.get_path()
                        if (path !== null) {
                            return { isPath: true, value: path }
                        }
                    }
                }
            }
        }
    }
    return null
}

function htmlToPango(text: string): string {
    let s = text
    // Convert HTML-only entities to unicode characters first
    s = s.replace(/&nbsp;/g, ' ')
    s = s.replace(/&mdash;/g, '\u2014')
    s = s.replace(/&ndash;/g, '\u2013')
    s = s.replace(/&hellip;/g, '\u2026')
    s = s.replace(/&laquo;/g, '\u00AB')
    s = s.replace(/&raquo;/g, '\u00BB')
    // Escape bare & not part of XML entities
    s = s.replace(/&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/gi, '&amp;')
    // Escape bare < that don't start a tag
    s = s.replace(/<(?![a-zA-Z/])/g, '&lt;')
    // <br> → newline
    s = s.replace(/<br\s*\/?>/gi, '\n')
    // Paragraphs → newlines
    s = s.replace(/<\/p>/gi, '\n')
    s = s.replace(/<p[^>]*>/gi, '')
    // Normalize HTML formatting tags to Pango equivalents
    s = s.replace(/<strong>/gi, '<b>')
    s = s.replace(/<\/strong>/gi, '</b>')
    s = s.replace(/<em>/gi, '<i>')
    s = s.replace(/<\/em>/gi, '</i>')
    // Strip anchor tags, keep their text content
    s = s.replace(/<a\b[^>]*>/gi, '')
    s = s.replace(/<\/a>/gi, '')
    // Strip img tags
    s = s.replace(/<img\b[^>]*\/?>/gi, '')
    // Strip attributes from supported Pango tags, strip unsupported tags entirely
    const allowed = new Set(['b', 'big', 'i', 's', 'sub', 'sup', 'small', 'tt', 'u'])
    s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\s*>/g, (_, slash, tag) => {
        const t = tag.toLowerCase()
        return allowed.has(t) ? (slash !== '' ? `</${t}>` : `<${t}>`) : ''
    })
    return s.trim()
}
function NotificationWidget(notification: Notifd.Notification) {
    const resolvedIcon = resolveAppIcon(notification.appIcon, notification.desktopEntry)
    const hasImage = notification.image !== '' && notification.image !== null && notification.image !== undefined
    const hasBody = notification.body !== '' && notification.body !== null && notification.body !== undefined
    const actions = notification.actions
    const hasActions = actions !== null && actions !== undefined && actions.length > 0
    const firstAction = hasActions ? actions[0] : null
    const secondAction = hasActions && actions.length > 1 ? actions[1] : null
    const extraActions = hasActions && actions.length > 2 ? actions.slice(2) : []

    return (
        <box class="notification" widthRequest={400} orientation={Gtk.Orientation.VERTICAL}>
            <button
                class={hasActions ? 'notification-card notification-card-has-actions' : 'notification-card'}
                hexpand={true}
                onClicked={() => notification.dismiss()}
            >
                <box orientation={Gtk.Orientation.VERTICAL}>
                <box class="notification-titlebar" hexpand={true} spacing={6}>
                    {resolvedIcon !== null && !resolvedIcon.isPath && <image class="notification-app-icon" iconName={resolvedIcon.value} pixelSize={16} />}
                    {resolvedIcon !== null && resolvedIcon.isPath && <image class="notification-app-icon" file={resolvedIcon.value} pixelSize={16} />}
                    <label
                        class="notification-app-name"
                        label={notification.appName || 'Unknown'}
                        halign={Gtk.Align.START}
                        hexpand={true}
                        ellipsize={3}
                    />
                </box>
                <box class="notification-content" hexpand={true} spacing={8}>
                <box class="notification-text" orientation={Gtk.Orientation.VERTICAL} hexpand={true} valign={Gtk.Align.CENTER}>
                    <label
                        class="notification-summary"
                        label={htmlToPango(notification.summary)}
                        useMarkup={true}
                        halign={Gtk.Align.START}
                        wrap={true}
                        maxWidthChars={1}
                        xalign={0}
                    />
                    {hasBody && (
                        <label
                            class="notification-body"
                            label={htmlToPango(notification.body)}
                            useMarkup={true}
                            halign={Gtk.Align.START}
                            wrap={true}
                            maxWidthChars={1}
                            xalign={0}
                        />
                    )}
                </box>
                {hasImage && (
                    <image
                        class="notification-image"
                        file={notification.image}
                        pixelSize={64}
                        valign={Gtk.Align.CENTER}
                    />
                )}
                </box>
                </box>
            </button>
            {hasActions && (
                <box class={extraActions.length > 0 ? 'notification-actions notification-actions-has-extra' : 'notification-actions'} hexpand={true}>
                    {firstAction !== null && (
                        <button
                            class="notification-action notification-action-primary"
                            hexpand={true}
                            onClicked={() => {
                                notification.invoke(firstAction.id)
                                notification.dismiss()
                            }}
                        >
                            <label label={firstAction.label} halign={Gtk.Align.CENTER} />
                        </button>
                    )}
                    {secondAction !== null && (
                        <button
                            class="notification-action notification-action-danger"
                            hexpand={true}
                            onClicked={() => {
                                notification.invoke(secondAction.id)
                                notification.dismiss()
                            }}
                        >
                            <label label={secondAction.label} halign={Gtk.Align.CENTER} />
                        </button>
                    )}
                </box>
            )}
            {extraActions.length > 0 && (
                <box class="notification-actions notification-actions-extra" hexpand={true}>
                    {extraActions.map(action => (
                        <button
                            class="notification-action notification-action-secondary"
                            hexpand={true}
                            onClicked={() => {
                                notification.invoke(action.id)
                                notification.dismiss()
                            }}
                        >
                            <label label={action.label} halign={Gtk.Align.CENTER} />
                        </button>
                    ))}
                </box>
            )}
        </box>
    )
}

export default function Notifications() {
    return (
        <window
            $={(self: Astal.Window) => {
                notifications.subscribe(() => {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        self.set_default_size(-1, -1)
                        self.queue_resize()
                        return GLib.SOURCE_REMOVE
                    })
                })
            }}
            visible={notifications(value => value.length > 0)}
            name="hyprbobr-notifications"
            namespace="hyprbobr-notifications"
            class="notifications"
            layer={Astal.Layer.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
        >
            <box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={8}
                marginTop={24}
                marginBottom={24}
                marginStart={24}
                marginEnd={24}
                valign={Gtk.Align.CENTER}
            >
                <For each={notifications}>
                    {notification => NotificationWidget(notification)}
                </For>
            </box>
        </window>
    )
}