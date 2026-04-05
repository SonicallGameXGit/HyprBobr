import app from 'ags/gtk4/app'
import { Astal, Gtk, Gdk } from 'ags/gtk4'
import { createPoll } from 'ags/time'
import { createBinding, For } from 'ags'
import AstalTray from 'gi://AstalTray'
import AstalHyprland from 'gi://AstalHyprland'

function Workspaces() {
    const hyprland = AstalHyprland.get_default()
    const workspaces = createBinding(hyprland, 'workspaces')
    const focusedWorkspace = createBinding(hyprland, 'focusedWorkspace')

    return (
        <box $type="center" spacing={4}>
            <For each={workspaces((value: AstalHyprland.Workspace[]) => value.filter((ws) => ws.id !== 0).sort((a, b) => a.id - b.id))}>
                {(workspace: AstalHyprland.Workspace) => (
                    <button
                        class={focusedWorkspace((currentWorkspace: AstalHyprland.Workspace) => {
                            if (currentWorkspace === undefined || currentWorkspace === null) {
                                return 'workspace'
                            }

                            if (currentWorkspace.id === workspace.id) {
                                return 'workspace workspace-active'
                            }

                            return 'workspace'
                        })}
                        onClicked={() => workspace.focus()}
                    >
                        <label label={workspace.name} />
                    </button>
                )}
            </For>
        </box>
    )
}
function Tray() {
    const tray = AstalTray.get_default()
    const items = createBinding(tray, 'items')

    const init = (button: Gtk.Button, item: AstalTray.TrayItem) => {
        console.log('Initializing tray item', JSON.stringify(JSON.parse(item.to_json_string()), null, 4))
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
