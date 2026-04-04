import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createPoll } from "ags/time"

export default function Bar(gdkmonitor: Gdk.Monitor) {
    const time = createPoll("", 1000, "date")

    const result = (
        <window
            visible
            name="hyprbobr-bar"
            namespace="hyprbobr-bar"
            class="Bar"
            layer={Astal.Layer.BOTTOM}
            gdkmonitor={gdkmonitor}
            exclusivity={Astal.Exclusivity.EXCLUSIVE}
            anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.LEFT | Astal.WindowAnchor.RIGHT}
            application={app}
            marginTop={12}
            marginLeft={12}
            marginRight={12}
        >
            <centerbox cssName="centerbox">
                <button $type="start" halign={Gtk.Align.START}>
                    <label label="Welcome to AGS!" />
                </button>
                <box $type="center" />
                <menubutton $type="end" hexpand halign={Gtk.Align.END}>
                    <label label={time} />
                    <popover>
                        <Gtk.Calendar />
                    </popover>
                </menubutton>
            </centerbox>
        </window>
    )
    return result
}
