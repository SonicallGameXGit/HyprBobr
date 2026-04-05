import { Astal, Gtk } from 'ags/gtk4'
import { notifications } from '../service/notifications'
import { For } from 'gnim'

export default function Notifications() {
    return (
        <window
            visible={notifications(value => value.length > 0)}
            name="hyprbobr-notifications"
            namespace="hyprbobr-notifications"
            layer={Astal.Layer.TOP}
            exclusivity={Astal.Exclusivity.NORMAL}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
            marginTop={24}
            marginRight={24}
        >
            <box orientation={Gtk.Orientation.VERTICAL} spacing={8}>
                <For each={notifications}>
                    {notification => {
                        const icon = notification.appIcon || 'dialog-information'
                        return (
                            <button class="notification" widthRequest={480} onClicked={() => notification.dismiss()}>
                                <image iconName={icon} />
                                <box valign={Gtk.Align.CENTER}>
                                    <label label={notification.summary} wrap />
                                    {notification.body !== '' && <label label={notification.body} wrap cssName="body" />}
                                </box>
                            </button>
                        )
                    }}
                </For>
            </box>
        </window>
    )
}