import { Astal, Gtk } from 'ags/gtk4'
import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import GioUnix from 'gi://GioUnix'
import Notifd from 'gi://AstalNotifd'
import { notifications } from '../service/notifications'
import { For } from 'gnim'

function pathFromFileUri(uri: string): string | null {
    if (uri.startsWith('file://') === false) {
        return null
    }

    try {
        return Gio.File.new_for_uri(uri).get_path()
    } catch {
        return null
    }
}

function existingPathFromValue(value: string): string | null {
    const trimmed = value.trim()
    if (trimmed === '') {
        return null
    }

    if (trimmed.startsWith('/')) {
        return GLib.file_test(trimmed, GLib.FileTest.EXISTS) ? trimmed : null
    }

    const uriPath = pathFromFileUri(trimmed)
    if (uriPath !== null && GLib.file_test(uriPath, GLib.FileTest.EXISTS)) {
        return uriPath
    }

    return null
}

function fileIconIfExists(path: string): Gio.Icon | null {
    const existingPath = existingPathFromValue(path)
    if (existingPath === null) {
        return null
    }
    return Gio.FileIcon.new(Gio.File.new_for_path(existingPath))
}

function maybeThemedIcon(iconName: string): Gio.Icon | null {
    if (iconName === '') {
        return null
    }

    return Gio.ThemedIcon.new(iconName)
}

function iconFromNotifySendValue(rawIcon: string): Gio.Icon | null {
    const value = rawIcon.trim()
    if (value === '') {
        return null
    }

    const candidates = value.split(',').map((v: string) => v.trim()).filter((v: string) => v !== '')

    for (const candidate of candidates) {
        if (candidate.startsWith('/')) {
            const byPath = fileIconIfExists(candidate)
            if (byPath !== null) {
                return byPath
            }
            continue
        }

        if (candidate.startsWith('file://')) {
            const byUri = Gio.File.new_for_uri(candidate)
            const byUriPath = byUri.get_path()
            if (byUriPath !== null) {
                const byPath = fileIconIfExists(byUriPath)
                if (byPath !== null) {
                    return byPath
                }
            }
            continue
        }

        const directName = maybeThemedIcon(candidate)
        if (directName !== null) {
            return directName
        }

        const stripped = candidate.replace(/\.(png|svg|xpm|jpg|jpeg|webp)$/i, '')
        if (stripped !== candidate) {
            const strippedName = maybeThemedIcon(stripped)
            if (strippedName !== null) {
                return strippedName
            }
        }

        try {
            const asIcon = Gio.Icon.new_for_string(candidate)
            if (asIcon !== null) {
                if (asIcon instanceof Gio.FileIcon) {
                    const path = asIcon.file.get_path()
                    if (path !== null) {
                        const validFileIcon = fileIconIfExists(path)
                        if (validFileIcon !== null) {
                            return validFileIcon
                        }
                    }
                } else {
                    return asIcon
                }
            }
        } catch {
            // Continue trying other candidates
        }
    }

    return null
}

function firstNonEmpty(values: (string | null | undefined)[]): string {
    for (const value of values) {
        if (value !== null && value !== undefined) {
            const trimmed = value.trim()
            if (trimmed !== '') {
                return trimmed
            }
        }
    }
    return ''
}

function resolveAppIcon(notification: Notifd.Notification): Gio.Icon {
    const propAppIcon = notification.appIcon
    const getterAppIcon = notification.get_app_icon()
    const propDesktopEntry = notification.desktopEntry
    const getterDesktopEntry = notification.get_desktop_entry()
    const propImage = notification.image
    const getterImage = notification.get_image()
    const hintImagePath = notification.get_str_hint('image-path')
    const hintImagePathUnderscore = notification.get_str_hint('image_path')
    const hintIconData = notification.get_str_hint('icon_data')

    const appIconValue = firstNonEmpty([propAppIcon, getterAppIcon])
    const imageValue = firstNonEmpty([propImage, getterImage, hintImagePath, hintImagePathUnderscore])
    const entryId = firstNonEmpty([propDesktopEntry, getterDesktopEntry])

    console.log(
        '[notifications] icon inputs',
        {
            id: notification.id,
            appName: notification.appName,
            summary: notification.summary,
            appIconProp: propAppIcon,
            appIconGetter: getterAppIcon,
            desktopEntryProp: propDesktopEntry,
            desktopEntryGetter: getterDesktopEntry,
            imageProp: propImage,
            imageGetter: getterImage,
            imagePathHint: hintImagePath,
            imagePathUnderscoreHint: hintImagePathUnderscore,
            iconDataHint: hintIconData,
        },
    )

    if (appIconValue !== '') {
        const byNotifySendIcon = iconFromNotifySendValue(appIconValue)
        if (byNotifySendIcon !== null) {
            console.log(`[notifications] icon resolved from appIcon="${appIconValue}"`)
            return byNotifySendIcon
        }

        console.log(`[notifications] appIcon provided but not resolved: "${appIconValue}"`)
    }

    if (appIconValue === '' && imageValue !== '' && existingPathFromValue(imageValue) === null) {
        const byImageIcon = iconFromNotifySendValue(imageValue)
        if (byImageIcon !== null) {
            console.log(`[notifications] icon resolved from image fallback="${imageValue}"`)
            return byImageIcon
        }
    }

    if (entryId !== '') {
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
                        for (const name of names) {
                            const byName = maybeThemedIcon(name)
                            if (byName !== null) {
                                console.log(`[notifications] icon resolved from desktopEntry="${entryId}" themed="${name}"`)
                                return byName
                            }
                        }
                    } else if (icon instanceof Gio.FileIcon) {
                        const path = icon.file.get_path()
                        if (path !== null) {
                            const byPath = fileIconIfExists(path)
                            if (byPath !== null) {
                                console.log(`[notifications] icon resolved from desktopEntry="${entryId}" file="${path}"`)
                                return byPath
                            }
                        }
                    } else {
                        console.log(`[notifications] icon resolved from desktopEntry="${entryId}" generic Gio.Icon`)
                        return icon
                    }
                }
            }
        }

        const entryAsIcon = maybeThemedIcon(entryId)
        if (entryAsIcon !== null) {
            console.log(`[notifications] icon resolved from desktopEntry as iconName="${entryId}"`)
            return entryAsIcon
        }
    }

    console.log('[notifications] falling back to default icon "application-x-executable"')
    return Gio.ThemedIcon.new('application-x-executable')
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

    // Preserve only a strict allowlist of tags and escape all other angle-bracket content.
    // This prevents pseudo-tags like <mail_id> from breaking GTK markup parsing.
    const allowed = new Set(['b', 'big', 'i', 's', 'sub', 'sup', 'small', 'tt', 'u'])
    const placeholders: string[] = []
    s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\s*>/g, (_, slash, tag) => {
        const t = tag.toLowerCase()
        if (!allowed.has(t)) {
            return _
        }
        const normalized = slash !== '' ? `</${t}>` : `<${t}>`
        const token = `__PANGO_TAG_${placeholders.length}__`
        placeholders.push(normalized)
        return token
    })

    s = s.replace(/&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/gi, '&amp;')
    s = s.replace(/</g, '&lt;')
    s = s.replace(/>/g, '&gt;')

    for (let i = 0; i < placeholders.length; i++) {
        s = s.replace(`__PANGO_TAG_${i}__`, placeholders[i])
    }

    return s.trim()
}
function NotificationWidget(notification: Notifd.Notification) {
    const resolvedIcon = resolveAppIcon(notification)
    const imageValue = firstNonEmpty([
        notification.image,
        notification.get_image(),
        notification.get_str_hint('image-path'),
        notification.get_str_hint('image_path'),
    ])
    const attachmentPath = existingPathFromValue(imageValue)
    const hasImage = attachmentPath !== null
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
                    <image class="notification-app-icon" gicon={resolvedIcon} pixelSize={16} />
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
                        file={attachmentPath}
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