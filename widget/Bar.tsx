import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createPoll } from "ags/time"
import AstalTray from "gi://AstalTray"
import { createBinding, For } from "ags"

function Tray() {
    const tray = AstalTray.get_default()
    const items = createBinding(tray, 'items')

    const init = (button: Gtk.MenuButton, item: AstalTray.TrayItem) => {
        button.menuModel = item.menuModel
        button.insert_action_group('dbusmenu', item.actionGroup)
        item.connect('notify::action-group', () => {
            button.insert_action_group('dbusmenu', item.actionGroup)
        })

        const gesture = new Gtk.GestureClick()
        gesture.set_button(0)
        gesture.connect('pressed', (self, _nPress, x, y) => {
            const currentButton = self.get_current_button()
            
            if (currentButton === Gdk.BUTTON_SECONDARY) {
                item.activate(x, y)
                return
            }
            // if (currentButton === Gdk.BUTTON_SECONDARY) {
            //     item.secondary_activate(x, y)
            //     return
            // }
        })

        button.add_controller(gesture)
    }

    return (
        <box $type="center" spacing={4} class="with-dividers">
            <For each={items((value: AstalTray.TrayItem[]) => value.filter((item) => item.id !== null))}>
                {(item: AstalTray.TrayItem) => (
                    <menubutton class="tray-item" $={(self) => init(self, item)} hasTooltip={true} tooltipText={item.title}>
                        <image gicon={createBinding(item, 'gicon')} pixelSize={20} />
                    </menubutton>
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
                {/* <box $type="center" spacing={8}>
                </box> */}
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
